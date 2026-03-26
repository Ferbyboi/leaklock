"""HousecallPro CRM webhook receiver.

Receives ``job_completed`` events from HousecallPro, verifies the webhook
secret from the ``Authorization`` header, normalizes the payload, durably
stores the event, then enqueues field-note parsing via Trigger.dev (with a
Celery fallback).

HousecallPro webhook docs:
    https://docs.housecallpro.com/docs/webhooks

Environment variables
---------------------
HOUSECALLPRO_WEBHOOK_SECRET   Shared secret provided by HousecallPro.
                               If unset, the Authorization check is skipped
                               (dev-only — always set in production).
"""
from __future__ import annotations

import json
import logging
import os
import uuid as uuid_mod
from datetime import datetime, timezone
from typing import Optional

import sentry_sdk
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.db import get_db as get_supabase
from app.connectors.webhook_normalizer import normalize_housecallpro

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/housecallpro", tags=["webhooks"])

_SECRET_ENV = "HOUSECALLPRO_WEBHOOK_SECRET"


# ── Authorization verification ────────────────────────────────────────────────

def _verify_hcp_secret(authorization: Optional[str], secret: str) -> bool:
    """Verify HousecallPro webhook Authorization header.

    HousecallPro sends the webhook secret as a Bearer token in the
    ``Authorization`` header.  We do a constant-time comparison to avoid
    timing attacks.
    """
    if not authorization:
        return False
    # Accept both "Bearer <secret>" and bare "<secret>"
    token = authorization.removeprefix("Bearer ").strip()
    import hmac as _hmac
    return _hmac.compare_digest(token, secret)


# ── Job ingestion helper ──────────────────────────────────────────────────────

def _ingest_normalized_job(normalized: dict, db) -> str:
    """Upsert job + field notes + draft invoice from a normalized payload.

    Returns the internal job UUID.  All DB writes include tenant_id.
    """
    tenant_id = normalized["tenant_id"]
    crm_job_id = normalized["crm_job_id"]

    job_result = (
        db.table("jobs")
        .upsert(
            {
                "tenant_id": tenant_id,
                "crm_job_id": crm_job_id,
                "status": normalized["status"],
            },
            on_conflict="tenant_id,crm_job_id",
        )
        .execute()
    )
    job_id: Optional[str] = (job_result.data or [{}])[0].get("id")
    if not job_id:
        raise RuntimeError(
            f"Failed to upsert HousecallPro job {crm_job_id} for tenant {tenant_id}"
        )

    # Build field notes from available context fields
    tech_notes_parts = []
    if normalized["technician_name"]:
        tech_notes_parts.append(f"Technician: {normalized['technician_name']}")
    if normalized["address"]:
        tech_notes_parts.append(f"Address: {normalized['address']}")
    if normalized["customer_name"] and normalized["customer_name"] != "Unknown":
        tech_notes_parts.append(f"Customer: {normalized['customer_name']}")

    tech_notes = "\n".join(tech_notes_parts).strip()

    db.table("field_notes").upsert(
        {
            "tenant_id": tenant_id,
            "job_id": job_id,
            "raw_text": tech_notes,
            "photo_urls": [],
            "parse_status": "pending",
        },
        on_conflict="tenant_id,job_id",
    ).execute()

    # Draft invoice from line items
    if normalized["line_items"]:
        # Convert to the internal LineItem schema used by the match engine:
        # description, qty, unit_price_cents
        internal_items = [
            {
                "description": item["description"],
                "qty": item["quantity"],
                "unit_price_cents": int(item["unit_price"] * 100),
                "unit": "each",
            }
            for item in normalized["line_items"]
        ]
        db.table("draft_invoices").upsert(
            {
                "tenant_id": tenant_id,
                "job_id": job_id,
                "line_items": internal_items,
            },
            on_conflict="tenant_id,job_id",
        ).execute()

    return job_id


# ── Webhook endpoint ──────────────────────────────────────────────────────────

@router.post("/job-complete")
async def receive_housecallpro_job_complete(
    request: Request,
    authorization: Optional[str] = Header(None),
    db=Depends(get_supabase),
) -> dict:
    """Receive a HousecallPro ``job_completed`` webhook.

    Processing steps
    ----------------
    1. Read raw body and verify Authorization secret.
    2. Resolve tenant from ``X-Tenant-ID`` header (or crm_account_id lookup).
    3. Store raw event in ``webhook_events`` for durability/idempotency.
    4. Normalize payload via ``normalize_housecallpro()``.
    5. Upsert job + field notes + draft invoice.
    6. Enqueue Trigger.dev task (Celery fallback if Trigger.dev unavailable).

    Returns 200 immediately — all processing is async per project rules.
    """
    body_bytes = await request.body()

    # 1. Authorization verification
    secret = os.getenv(_SECRET_ENV, "")
    if secret:
        if not _verify_hcp_secret(authorization, secret):
            logger.warning(
                "HousecallPro Authorization mismatch — client=%s", request.client
            )
            raise HTTPException(status_code=401, detail="Invalid webhook secret")
    else:
        logger.warning(
            "%s not set — skipping HousecallPro Authorization check (dev mode)",
            _SECRET_ENV,
        )

    # 2. Parse JSON
    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # 3. Resolve tenant
    tenant_id: Optional[str] = request.headers.get("X-Tenant-ID")
    if not tenant_id:
        # Attempt lookup via HousecallPro company ID
        hcp_company_id = (
            payload.get("company_id")
            or (payload.get("work_order") or {}).get("company_id")
        )
        if hcp_company_id:
            tenant_res = (
                db.table("tenants")
                .select("id")
                .eq("crm_account_id", str(hcp_company_id))
                .single()
                .execute()
            )
            if tenant_res.data:
                tenant_id = tenant_res.data["id"]

    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail="Missing tenant — provide X-Tenant-ID header or configure crm_account_id",
        )

    # 4. Idempotency key from HousecallPro event ID or generated UUID
    event_external_id = (
        payload.get("id")
        or payload.get("event_id")
        or request.headers.get("X-HCP-Event-ID")
        or str(uuid_mod.uuid4())
    )
    idempotency_key = f"housecallpro-{event_external_id}"

    event_type = _safe_str(
        payload.get("event_type") or payload.get("eventType"), "job_completed"
    )

    # 5. Durably store raw event
    try:
        insert_res = (
            db.table("webhook_events")
            .insert(
                {
                    "source": "housecallpro",
                    "event_type": event_type,
                    "idempotency_key": idempotency_key,
                    "raw_payload": payload,
                    "tenant_id": tenant_id,
                    "status": "received",
                }
            )
            .execute()
        )
        event_id: Optional[str] = (insert_res.data or [{}])[0].get("id")
    except Exception as exc:
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            logger.info(
                "Duplicate HousecallPro delivery %s — already processed",
                idempotency_key,
            )
            return {"received": True, "action": "duplicate_ignored"}
        logger.error("Failed to store HousecallPro webhook event: %s", exc)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("idempotency_key", idempotency_key)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    if not event_id:
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    # 6. Normalize payload
    try:
        normalized = normalize_housecallpro(payload, tenant_id)
    except Exception as exc:
        logger.error(
            "HousecallPro payload normalization failed event_id=%s: %s", event_id, exc
        )
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("event_id", event_id)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        db.table("webhook_events").update(
            {"status": "error", "processed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", event_id).eq("tenant_id", tenant_id).execute()
        raise HTTPException(status_code=422, detail="Payload normalization failed")

    if not normalized["crm_job_id"]:
        logger.warning(
            "HousecallPro webhook missing job ID — event_id=%s tenant=%s",
            event_id,
            tenant_id,
        )
        db.table("webhook_events").update(
            {"status": "complete", "processed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", event_id).eq("tenant_id", tenant_id).execute()
        return {"received": True, "action": "ignored_missing_job_id"}

    # 7. Upsert job / field notes / invoice
    try:
        job_id = _ingest_normalized_job(normalized, db)
    except Exception as exc:
        logger.error(
            "HousecallPro job ingestion failed event_id=%s crm_job_id=%s: %s",
            event_id,
            normalized["crm_job_id"],
            exc,
        )
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("event_id", event_id)
            scope.set_tag("crm_job_id", normalized["crm_job_id"])
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=500, detail="Failed to ingest job")

    logger.info(
        "HousecallPro job ingested job_id=%s crm_job_id=%s tenant_id=%s",
        job_id,
        normalized["crm_job_id"],
        tenant_id,
    )

    # 8. Enqueue processing — Trigger.dev first, Celery fallback
    trigger_payload = {
        "webhook_event_id": event_id,
        "job_id": job_id,
        "tenant_id": tenant_id,
    }

    from app.core.trigger_client import trigger_task

    run_id = await trigger_task(
        task_id="process-housecallpro-webhook",
        payload=trigger_payload,
        idempotency_key=idempotency_key,
    )

    if run_id:
        db.table("webhook_events").update({"trigger_run_id": run_id}).eq(
            "id", event_id
        ).eq("tenant_id", tenant_id).execute()
        return {
            "received": True,
            "action": "queued_trigger",
            "job_id": job_id,
            "run_id": run_id,
        }

    # Celery fallback
    try:
        from app.workers.tasks import process_field_notes

        task = process_field_notes.delay(job_id, tenant_id)
        db.table("webhook_events").update(
            {"status": "complete", "processed_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", event_id).eq("tenant_id", tenant_id).execute()
        return {
            "received": True,
            "action": "queued_celery",
            "job_id": job_id,
            "task_id": task.id,
        }
    except Exception as exc:
        logger.error(
            "Celery fallback failed for HousecallPro job_id=%s: %s", job_id, exc
        )
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("job_id", job_id)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        # Job is already stored — return success so HousecallPro stops retrying.
        # The batch worker will pick it up on the next cycle.
        return {
            "received": True,
            "action": "stored_pending_batch",
            "job_id": job_id,
        }


# ── Private helpers ───────────────────────────────────────────────────────────

def _safe_str(value: object, default: str = "") -> str:
    """Coerce *value* to str, stripping whitespace."""
    if value is None:
        return default
    return str(value).strip() or default
