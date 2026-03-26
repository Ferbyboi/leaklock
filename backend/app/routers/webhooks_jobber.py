"""Jobber CRM webhook receiver + payload normalizer.

Receives webhook events from Jobber, validates the signature,
normalizes the payload into the standard LeakLock JobPayload schema,
then upserts the job and queues AI parsing.

Jobber webhook docs: https://developer.getjobber.com/docs/build_with_jobber/webhooks/
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import sentry_sdk
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from app.auth import get_current_user
from app.db import get_db as get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks/jobber", tags=["webhooks"])


# ── Standard LeakLock JobPayload schema ────────────────────────────────────────

class LineItem(BaseModel):
    description: str
    qty: float = 1.0
    unit_price_cents: int = 0
    unit: str = "each"


class JobPayload(BaseModel):
    crm_job_id: str
    crm_source: str = "jobber"
    tenant_id: str
    client_name: str
    client_address: Optional[str] = None
    tech_notes: Optional[str] = None
    photo_urls: list[str] = []
    estimate_items: list[LineItem] = []
    invoice_items: list[LineItem] = []
    job_status: str = "pending"


# ── Signature verification ─────────────────────────────────────────────────────

def _verify_jobber_signature(
    body: bytes,
    signature: Optional[str],
    secret: Optional[str],
) -> bool:
    """Verify Jobber HMAC-SHA256 webhook signature."""
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── Payload normalizer ─────────────────────────────────────────────────────────

def normalize_jobber_payload(
    event_type: str,
    data: dict[str, Any],
    tenant_id: str,
) -> Optional[JobPayload]:
    """Convert Jobber webhook payload to standard LeakLock JobPayload.

    Returns None if the event type is not actionable.
    """
    job = data.get("job") or data.get("invoice") or {}
    client = job.get("client") or {}

    def _cents(amount) -> int:
        try:
            return int(float(amount or 0) * 100)
        except (ValueError, TypeError):
            return 0

    def _line_items(items: list) -> list[LineItem]:
        result = []
        for item in items or []:
            result.append(LineItem(
                description=item.get("name") or item.get("description") or "Unknown",
                qty=float(item.get("quantity") or 1),
                unit_price_cents=_cents(item.get("unitPrice") or item.get("unit_price")),
                unit=item.get("unit") or "each",
            ))
        return result

    status_map = {
        "active": "in_progress",
        "completed": "pending_invoice",
        "invoiced": "pending_invoice",
        "archived": "complete",
    }

    job_status = status_map.get(
        str(job.get("status") or "").lower(), "pending"
    )

    return JobPayload(
        crm_job_id=str(job.get("id") or data.get("id") or ""),
        tenant_id=tenant_id,
        client_name=(
            client.get("name")
            or f"{client.get('firstName','')} {client.get('lastName','')}".strip()
            or "Unknown"
        ),
        client_address=client.get("billingAddress", {}).get("street"),
        tech_notes=job.get("internalNotes") or job.get("description"),
        photo_urls=[
            a.get("url") for a in (job.get("attachments") or [])
            if a.get("url")
        ],
        estimate_items=_line_items(
            (job.get("quote") or {}).get("lineItems")
            or job.get("lineItems")
            or []
        ),
        invoice_items=_line_items(
            data.get("invoice", {}).get("lineItems") or []
        ),
        job_status=job_status,
    )


# ── Webhook endpoint ───────────────────────────────────────────────────────────

@router.post("")
async def receive_jobber_webhook(
    request: Request,
    x_jobber_hmac_sha256: Optional[str] = Header(None),
    db=Depends(get_supabase),
) -> dict:
    """Receive and durably store Jobber webhook events.

    Step 1: Validate HMAC signature.
    Step 2: Store raw event in webhook_events table (durable).
    Step 3: Enqueue processing via Trigger.dev (with retries) or Celery fallback.

    Returns 200 immediately so Jobber stops retrying — processing is async.
    """
    import os
    import uuid as uuid_mod
    from app.core.trigger_client import trigger_task

    body = await request.body()
    secret = os.getenv("JOBBER_WEBHOOK_SECRET")

    if secret and not _verify_jobber_signature(body, x_jobber_hmac_sha256, secret):
        raise HTTPException(status_code=401, detail="Invalid Jobber signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = payload.get("webHookEvent") or payload.get("event", "")
    jobber_account_id = payload.get("accountId") or payload.get("account_id")

    # Idempotency key from Jobber delivery headers or generate from payload
    delivery_id = request.headers.get("x-jobber-delivery") or str(uuid_mod.uuid4())
    idempotency_key = f"jobber-{delivery_id}"

    # Look up tenant
    tenant_result = (
        db.table("tenants")
        .select("id")
        .eq("crm_account_id", str(jobber_account_id or ""))
        .single()
        .execute()
    )
    if not tenant_result.data:
        logger.warning("Jobber webhook for unknown account: %s", jobber_account_id)
        return {"received": True, "action": "ignored_unknown_tenant"}

    tenant_id = tenant_result.data["id"]

    # ── Step 1: Store event durably ───────────────────────────────────────────
    try:
        insert_res = (
            db.table("webhook_events")
            .insert({
                "source": "jobber",
                "event_type": event_type,
                "idempotency_key": idempotency_key,
                "raw_payload": payload,
                "tenant_id": tenant_id,
                "status": "received",
            })
            .execute()
        )
        event_id = (insert_res.data or [{}])[0].get("id")
    except Exception as exc:
        # Duplicate delivery — already processed
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            return {"received": True, "action": "duplicate_ignored"}
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    if not event_id:
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    # ── Step 2: Enqueue processing ────────────────────────────────────────────
    trigger_payload = {"webhook_event_id": event_id}

    # Try Trigger.dev first (durable, with retries on their side)
    run_id = await trigger_task(
        task_id="process-jobber-webhook",
        payload=trigger_payload,
        idempotency_key=idempotency_key,
    )

    if run_id:
        # Update event with Trigger.dev run ID for correlation
        db.table("webhook_events").update({"trigger_run_id": run_id}).eq("id", event_id).execute()
        return {"received": True, "action": "queued_trigger", "run_id": run_id}

    # ── Celery fallback (Trigger.dev not configured) ──────────────────────────
    data = payload.get("data") or {}
    normalized = normalize_jobber_payload(event_type, data, tenant_id)
    if not normalized:
        db.table("webhook_events").update({"status": "complete", "processed_at": datetime.now(timezone.utc).isoformat()}).eq("id", event_id).execute()
        return {"received": True, "action": "ignored_event_type", "event": event_type}

    from app.workers.tasks import process_field_notes, run_three_way_match

    # Upsert job
    job_result = (
        db.table("jobs")
        .upsert({
            "tenant_id": tenant_id,
            "crm_job_id": normalized.crm_job_id,
            "status": normalized.job_status,
        }, on_conflict="tenant_id,crm_job_id")
        .execute()
    )
    job_id = (job_result.data or [{}])[0].get("id")
    if not job_id:
        raise HTTPException(status_code=500, detail="Failed to upsert job")

    if "JOB_COMPLETED" in event_type.upper() or "JOB_UPDATE" in event_type.upper():
        if normalized.tech_notes or normalized.photo_urls:
            db.table("field_notes").upsert({
                "tenant_id": tenant_id,
                "job_id": job_id,
                "raw_text": normalized.tech_notes or "",
                "photo_urls": normalized.photo_urls,
                "parse_status": "pending",
            }, on_conflict="tenant_id,job_id").execute()
        if normalized.estimate_items:
            db.table("estimates").upsert({
                "tenant_id": tenant_id,
                "job_id": job_id,
                "line_items": [i.model_dump() for i in normalized.estimate_items],
            }, on_conflict="tenant_id,job_id").execute()
        task = process_field_notes.delay(job_id, tenant_id)
        db.table("webhook_events").update({"status": "complete", "processed_at": datetime.now(timezone.utc).isoformat()}).eq("id", event_id).execute()
        return {"received": True, "action": "queued_parse", "task_id": task.id}

    if "INVOICE" in event_type.upper():
        if normalized.invoice_items:
            db.table("draft_invoices").upsert({
                "tenant_id": tenant_id,
                "job_id": job_id,
                "line_items": [i.model_dump() for i in normalized.invoice_items],
            }, on_conflict="tenant_id,job_id").execute()
        task = run_three_way_match.delay(job_id, tenant_id)
        db.table("webhook_events").update({"status": "complete", "processed_at": datetime.now(timezone.utc).isoformat()}).eq("id", event_id).execute()
        return {"received": True, "action": "queued_match", "task_id": task.id}

    db.table("webhook_events").update({"status": "complete", "processed_at": datetime.now(timezone.utc).isoformat()}).eq("id", event_id).execute()
    return {"received": True, "action": "no_action", "event": event_type}
