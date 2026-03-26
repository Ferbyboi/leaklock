"""Shared CRM webhook payload normalizer.

Converts any CRM-specific webhook payload into LeakLock's internal job format.
All normalizer functions return a dict matching the canonical schema below:

    {
        "crm_job_id":       str,
        "tenant_id":        str,
        "customer_name":    str,
        "address":          str,
        "scheduled_date":   str (ISO-8601),
        "line_items":       [{"description": str, "quantity": float, "unit_price": float}],
        "technician_name":  str,
        "status":           str,
        "raw_payload":      dict,
    }

Each function is pure (no I/O) so it can be unit-tested in isolation.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _safe_float(value: Any, default: float = 0.0) -> float:
    """Coerce *value* to float, returning *default* on failure."""
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


def _safe_str(value: Any, default: str = "") -> str:
    """Coerce *value* to str, stripping whitespace."""
    if value is None:
        return default
    return str(value).strip() or default


def _empty_job(tenant_id: str, raw_payload: dict) -> dict:
    """Return a skeleton job dict with safe defaults."""
    return {
        "crm_job_id": "",
        "tenant_id": tenant_id,
        "customer_name": "Unknown",
        "address": "",
        "scheduled_date": "",
        "line_items": [],
        "technician_name": "",
        "status": "pending",
        "raw_payload": raw_payload,
    }


# ── Jobber ────────────────────────────────────────────────────────────────────

def normalize_jobber(payload: dict, tenant_id: str) -> dict:
    """Normalize a Jobber webhook payload.

    Jobber sends a top-level ``webHookEvent`` string and a ``data`` dict that
    contains either a ``job`` or an ``invoice`` key.

    Reference: https://developer.getjobber.com/docs/build_with_jobber/webhooks/
    """
    out = _empty_job(tenant_id, payload)

    data = payload.get("data") or {}
    job = data.get("job") or data.get("invoice") or {}
    client = job.get("client") or {}
    billing_address = client.get("billingAddress") or {}

    out["crm_job_id"] = _safe_str(
        job.get("id") or data.get("id"),
        default=_safe_str(payload.get("id")),
    )

    first = _safe_str(client.get("firstName"))
    last = _safe_str(client.get("lastName"))
    out["customer_name"] = (
        _safe_str(client.get("name"))
        or f"{first} {last}".strip()
        or "Unknown"
    )

    out["address"] = _safe_str(
        billing_address.get("street")
        or billing_address.get("city")
    )

    out["scheduled_date"] = _safe_str(
        job.get("startAt") or job.get("scheduledStart")
    )

    # Technician — Jobber uses an array of assigned users
    assigned = job.get("assignedTo") or []
    if assigned:
        first_tech = assigned[0] if isinstance(assigned, list) else assigned
        out["technician_name"] = _safe_str(
            first_tech.get("name")
            or f"{first_tech.get('firstName','')} {first_tech.get('lastName','')}".strip()
        )

    # Status mapping
    jobber_status = _safe_str(job.get("status")).lower()
    status_map = {
        "active": "in_progress",
        "completed": "pending_invoice",
        "invoiced": "pending_invoice",
        "archived": "complete",
    }
    out["status"] = status_map.get(jobber_status, "pending")

    # Line items from quote or job directly
    raw_items = (
        (job.get("quote") or {}).get("lineItems")
        or job.get("lineItems")
        or []
    )
    out["line_items"] = [
        {
            "description": _safe_str(
                i.get("name") or i.get("description"), "Unknown"
            ),
            "quantity": _safe_float(i.get("quantity"), 1.0),
            "unit_price": _safe_float(
                i.get("unitPrice") or i.get("unit_price")
            ),
        }
        for i in raw_items
    ]

    return out


# ── ServiceTitan ──────────────────────────────────────────────────────────────

def normalize_servicetitan(payload: dict, tenant_id: str) -> dict:
    """Normalize a ServiceTitan ``job.complete`` webhook payload.

    ServiceTitan wraps job data under a top-level ``job`` key.  Invoice line
    items live under ``job.invoice.items``.

    Key field names
    ---------------
    job.id                  → crm_job_id
    job.customer.name       → customer_name
    job.location.address    → address
    job.scheduledDate       → scheduled_date
    job.invoice.items[]     → line_items (each: description, quantity, unitPrice)
    job.technician.name     → technician_name
    job.status              → status
    """
    out = _empty_job(tenant_id, payload)

    job = payload.get("job") or payload
    customer = job.get("customer") or {}
    location = job.get("location") or {}
    invoice = job.get("invoice") or {}
    technician = job.get("technician") or {}

    out["crm_job_id"] = _safe_str(job.get("id"))

    out["customer_name"] = _safe_str(customer.get("name"), "Unknown")

    # ServiceTitan may nest address as a string or as an object
    addr_raw = location.get("address")
    if isinstance(addr_raw, dict):
        parts = [
            addr_raw.get("street", ""),
            addr_raw.get("city", ""),
            addr_raw.get("state", ""),
            addr_raw.get("zip", ""),
        ]
        out["address"] = ", ".join(p for p in parts if p).strip()
    else:
        out["address"] = _safe_str(addr_raw)

    out["scheduled_date"] = _safe_str(
        job.get("scheduledDate") or job.get("schedule", {}).get("start")
    )

    out["technician_name"] = _safe_str(technician.get("name"))

    # Status mapping from ServiceTitan job statuses
    st_status = _safe_str(job.get("status")).lower()
    status_map = {
        "completed": "pending_invoice",
        "done": "pending_invoice",
        "invoiced": "pending_invoice",
        "inprogress": "in_progress",
        "in progress": "in_progress",
        "scheduled": "pending",
        "dispatched": "in_progress",
        "cancelled": "cancelled",
    }
    out["status"] = status_map.get(st_status, "pending")

    # Invoice line items
    raw_items = invoice.get("items") or []
    out["line_items"] = [
        {
            "description": _safe_str(
                i.get("description") or i.get("name"), "Unknown"
            ),
            "quantity": _safe_float(i.get("quantity") or i.get("qty"), 1.0),
            "unit_price": _safe_float(
                i.get("unitPrice") or i.get("unit_price") or i.get("price")
            ),
        }
        for i in raw_items
    ]

    return out


# ── HousecallPro ──────────────────────────────────────────────────────────────

def normalize_housecallpro(payload: dict, tenant_id: str) -> dict:
    """Normalize a HousecallPro ``job_completed`` webhook payload.

    HousecallPro sends the job data under a ``work_order`` key.

    Key field names
    ---------------
    work_order.id                       → crm_job_id
    work_order.customer.name            → customer_name
    work_order.address (str or object)  → address
    work_order.scheduled_start          → scheduled_date
    work_order.line_items[]             → line_items
    work_order.assigned_employees[0]    → technician_name
    event_type                          → used for status mapping
    """
    out = _empty_job(tenant_id, payload)

    work_order = payload.get("work_order") or payload
    customer = work_order.get("customer") or {}

    out["crm_job_id"] = _safe_str(
        work_order.get("id") or work_order.get("work_order_id")
    )

    out["customer_name"] = _safe_str(
        customer.get("name")
        or f"{customer.get('first_name','')} {customer.get('last_name','')}".strip()
        or "Unknown"
    )

    # HousecallPro may send address as a flat string or a nested object
    addr_raw = work_order.get("address")
    if isinstance(addr_raw, dict):
        parts = [
            addr_raw.get("street", ""),
            addr_raw.get("city", ""),
            addr_raw.get("state", ""),
            addr_raw.get("zip", ""),
        ]
        out["address"] = ", ".join(p for p in parts if p).strip()
    else:
        out["address"] = _safe_str(addr_raw)

    out["scheduled_date"] = _safe_str(
        work_order.get("scheduled_start") or work_order.get("start_time")
    )

    # First assigned employee is the lead technician
    employees = work_order.get("assigned_employees") or []
    if employees:
        first = employees[0] if isinstance(employees, list) else employees
        out["technician_name"] = _safe_str(
            first.get("name")
            or f"{first.get('first_name','')} {first.get('last_name','')}".strip()
        )

    # Status derived from event_type
    event_type = _safe_str(payload.get("event_type")).lower()
    if "complet" in event_type:
        out["status"] = "pending_invoice"
    elif "in_progress" in event_type or "started" in event_type:
        out["status"] = "in_progress"
    elif "cancel" in event_type:
        out["status"] = "cancelled"
    else:
        out["status"] = "pending"

    # Line items
    raw_items = work_order.get("line_items") or []
    out["line_items"] = [
        {
            "description": _safe_str(
                i.get("name") or i.get("description"), "Unknown"
            ),
            "quantity": _safe_float(i.get("quantity") or i.get("qty"), 1.0),
            "unit_price": _safe_float(
                i.get("unit_price") or i.get("unitPrice") or i.get("price")
            ),
        }
        for i in raw_items
    ]

    return out


# ── Toast POS ─────────────────────────────────────────────────────────────────

def normalize_toast(payload: dict, tenant_id: str) -> dict:
    """Normalize a Toast POS ``order_completed`` or ``check_closed`` webhook payload.

    Toast sends restaurant order/check data.  Line items live under
    ``order.checks[].selections`` and carry modifiers as nested arrays.

    Key field names
    ---------------
    order.guid                              → crm_job_id
    order.checks[0].customer               → customer_name
    order.restaurantName / order.diningArea → address
    order.createdDate                       → scheduled_date
    order.server / order.openedBy           → technician_name
    order.checks[0].selections[]            → line_items
    """
    out = _empty_job(tenant_id, payload)

    order = payload.get("order") or payload
    checks = order.get("checks") or []
    first_check = checks[0] if checks else {}
    customer = first_check.get("customer") or {}

    out["crm_job_id"] = _safe_str(
        order.get("guid") or order.get("externalId") or order.get("id")
    )

    out["customer_name"] = _safe_str(
        customer.get("firstName", "") + " " + customer.get("lastName", "")
    ).strip() or _safe_str(customer.get("email"), "Guest")

    restaurant = _safe_str(order.get("restaurantName") or order.get("diningArea", {}).get("name") if isinstance(order.get("diningArea"), dict) else order.get("diningArea"))
    out["address"] = restaurant or "Restaurant"

    out["scheduled_date"] = _safe_str(
        order.get("createdDate") or order.get("openedDate")
    )

    server = order.get("server") or order.get("openedBy") or {}
    out["technician_name"] = _safe_str(
        server.get("firstName", "") + " " + server.get("lastName", "")
    ).strip() if isinstance(server, dict) else _safe_str(server)

    # Status mapping from Toast order status
    toast_status = _safe_str(order.get("displayState") or order.get("voided")).lower()
    if toast_status in ("true", "voided"):
        out["status"] = "cancelled"
    elif "closed" in toast_status or "paid" in toast_status:
        out["status"] = "pending_invoice"
    else:
        out["status"] = "pending"

    # Line items from check selections
    raw_items = first_check.get("selections") or []
    out["line_items"] = [
        {
            "description": _safe_str(
                i.get("displayName") or i.get("name") or i.get("itemGroupName"), "Unknown"
            ),
            "quantity": _safe_float(i.get("quantity"), 1.0),
            "unit_price": _safe_float(i.get("price") or i.get("unitOfMeasure")),
        }
        for i in raw_items
    ]

    return out


# ── Square ────────────────────────────────────────────────────────────────────

def normalize_square(payload: dict, tenant_id: str) -> dict:
    """Normalize a Square ``order.completed`` or ``payment.completed`` webhook payload.

    Square wraps event data under a top-level ``data.object`` key.

    Key field names
    ---------------
    data.object.order.id                    → crm_job_id
    data.object.order.fulfillments[0]       → customer/address info
    data.object.order.line_items[]          → line_items
    data.object.order.created_at            → scheduled_date
    merchant_id                             → used for tenant lookup
    """
    out = _empty_job(tenant_id, payload)

    data_obj = payload.get("data", {}).get("object", {})
    order = data_obj.get("order") or data_obj.get("payment") or payload

    out["crm_job_id"] = _safe_str(
        order.get("id") or payload.get("event_id")
    )

    # Customer info lives in fulfillments for delivery/pickup orders
    fulfillments = order.get("fulfillments") or []
    fulfillment = fulfillments[0] if fulfillments else {}
    fulfillment_details = (
        fulfillment.get("pickup_details")
        or fulfillment.get("delivery_details")
        or {}
    )
    recipient = fulfillment_details.get("recipient") or {}

    out["customer_name"] = _safe_str(
        recipient.get("display_name")
        or recipient.get("email_address")
        or "Guest"
    )

    # Address from pickup/delivery
    address_obj = recipient.get("address") or {}
    if isinstance(address_obj, dict):
        parts = [
            address_obj.get("address_line_1", ""),
            address_obj.get("locality", ""),
            address_obj.get("administrative_district_level_1", ""),
            address_obj.get("postal_code", ""),
        ]
        out["address"] = ", ".join(p for p in parts if p).strip()
    else:
        out["address"] = _safe_str(address_obj)

    out["scheduled_date"] = _safe_str(
        order.get("created_at") or order.get("updated_at")
    )

    # Square doesn't have a direct "technician" concept — use location or cashier
    out["technician_name"] = _safe_str(
        order.get("location_id") or payload.get("merchant_id", "")
    )

    # Status mapping from Square order state
    sq_state = _safe_str(order.get("state")).upper()
    state_map = {
        "COMPLETED": "pending_invoice",
        "OPEN": "in_progress",
        "CANCELED": "cancelled",
    }
    out["status"] = state_map.get(sq_state, "pending")

    # Line items
    raw_items = order.get("line_items") or []
    out["line_items"] = [
        {
            "description": _safe_str(
                i.get("name") or i.get("variation_name"), "Unknown"
            ),
            "quantity": _safe_float(i.get("quantity"), 1.0),
            "unit_price": _safe_float(
                (i.get("base_price_money") or {}).get("amount", 0)
            ) / 100,  # Square uses cents
        }
        for i in raw_items
    ]

    return out


# ── Generic fallback ──────────────────────────────────────────────────────────

def normalize_generic(payload: dict, tenant_id: str) -> dict:
    """Best-effort normalizer for unknown CRM payloads.

    Tries common field name patterns from multiple CRMs.  Used as a fallback
    when the CRM source cannot be identified.
    """
    out = _empty_job(tenant_id, payload)

    out["crm_job_id"] = _safe_str(
        payload.get("crm_job_id")
        or payload.get("job_id")
        or payload.get("id")
    )

    out["customer_name"] = _safe_str(
        payload.get("customer_name")
        or payload.get("client_name")
        or payload.get("customer", {}).get("name")
        or "Unknown"
    )

    out["address"] = _safe_str(
        payload.get("address")
        or payload.get("location")
        or payload.get("service_address")
    )

    out["scheduled_date"] = _safe_str(
        payload.get("scheduled_date")
        or payload.get("scheduledDate")
        or payload.get("scheduled_start")
        or payload.get("start_time")
    )

    out["technician_name"] = _safe_str(
        payload.get("technician_name")
        or payload.get("tech_name")
        or payload.get("assigned_tech")
    )

    out["status"] = _safe_str(payload.get("status"), "pending")

    raw_items = (
        payload.get("line_items")
        or payload.get("items")
        or []
    )
    out["line_items"] = [
        {
            "description": _safe_str(
                i.get("description") or i.get("name"), "Unknown"
            ),
            "quantity": _safe_float(i.get("quantity") or i.get("qty"), 1.0),
            "unit_price": _safe_float(
                i.get("unit_price")
                or i.get("unitPrice")
                or i.get("price")
            ),
        }
        for i in raw_items
    ]

    return out
