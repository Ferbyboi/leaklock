"""Toast POS webhook receiver.

Receives ``order.completed`` / ``check.closed`` events from Toast POS,
verifies the HMAC-SHA256 signature, normalizes the payload, durably stores
the event, then enqueues field-note parsing.

Toast webhook docs:
    https://doc.toasttab.com/openapi/webhooks/

Environment variables
---------------------
TOAST_WEBHOOK_SECRET   HMAC-SHA256 signing secret from Toast.
                       If unset, signature verification is skipped
                       (dev-only — always set in production).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import uuid as uuid_mod
from typing import Optional

import sentry_sdk
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.db import get_db as get_supabase
from app.connectors.webhook_normalizer import normalize_toast

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/toast", tags=["webhooks"])

_SECRET_ENV = "TOAST_WEBHOOK_SECRET"


# ── Signature verification ────────────────────────────────────────────────────

def _verify_signature(body: bytes, signature: str, secret: str) -> bool:
    """Verify Toast HMAC-SHA256 webhook signature.

    Toast signs the raw request body and places the hex digest in
    ``Toast-Signature`` header.
    """
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()  # type: ignore[attr-defined]
    return hmac.compare_digest(expected, signature.lstrip("sha256="))


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
            f"Failed to upsert Toast job {crm_job_id} for tenant {tenant_id}"
        )

    tech_notes = (
        f"Server: {normalized['technician_name']}\n"
        f"Location: {normalized['address']}\n"
        f"Customer: {normalized['customer_name']}"
    ).strip()

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

    if normalized["line_items"]:
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

@router.post("/order-complete")
async def receive_toast_order_complete(
    request: Request,
    toast_signature: Optional[str] = Header(None, alias="Toast-Signature"),
    db=Depends(get_supabase),
) -> dict:
    """Receive a Toast ``order.completed`` or ``check.closed`` webhook.

    Returns 200 immediately — all heavy processing is async.
    """
    body_bytes = await request.body()

    # 1. Signature verification
    secret = os.getenv(_SECRET_ENV, "")
    if secret:
        sig = toast_signature or ""
        if not sig or not _verify_signature(body_bytes, sig, secret):
            logger.warning(
                "Toast signature mismatch — client=%s sig=%s",
                request.client,
                toast_signature,
            )
            raise HTTPException(status_code=401, detail="Invalid webhook signature")
    else:
        logger.warning(
            "%s not set — skipping Toast signature check (dev mode)", _SECRET_ENV
        )

    # 2. Parse JSON
    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # 3. Resolve tenant via X-Tenant-ID header or restaurant GUID lookup
    tenant_id: Optional[str] = request.headers.get("X-Tenant-ID")
    if not tenant_id:
        restaurant_guid = (
            payload.get("restaurantGuid")
            or (payload.get("order") or {}).get("restaurantGuid")
        )
        if restaurant_guid:
            tenant_res = (
                db.table("tenants")
                .select("id")
                .eq("crm_account_id", str(restaurant_guid))
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

    # 4. Idempotency key
    delivery_id = (
        request.headers.get("Toast-Event-Id")
        or request.headers.get("X-Request-Id")
        or str(uuid_mod.uuid4())
    )
    idempotency_key = f"toast-{delivery_id}"

    event_type = _safe_event_type(payload)

    # 5. Durably store raw event
    try:
        insert_res = (
            db.table("webhook_events")
            .insert(
                {
                    "source": "toast",
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
            logger.info("Duplicate Toast event %s — already processed", idempotency_key)
            return {"received": True, "action": "duplicate_ignored"}
        logger.error("Failed to store Toast webhook event: %s", exc)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("idempotency_key", idempotency_key)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    if not event_id:
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    # 6. Normalize payload
    try:
        normalized = normalize_toast(payload, tenant_id)
    except Exception as exc:
        logger.error("Toast payload normalization failed event_id=%s: %s", event_id, exc)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("event_id", event_id)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        db.table("webhook_events").update(
            {"status": "error", "processed_at": "now()"}
        ).eq("id", event_id).eq("tenant_id", tenant_id).execute()
        raise HTTPException(status_code=422, detail="Payload normalization failed")

    if not normalized["crm_job_id"]:
        db.table("webhook_events").update(
            {"status": "complete", "processed_at": "now()"}
        ).eq("id", event_id).eq("tenant_id", tenant_id).execute()
        return {"received": True, "action": "ignored_missing_job_id"}

    # 7. Upsert job / field notes / invoice
    try:
        job_id = _ingest_normalized_job(normalized, db)
    except Exception as exc:
        logger.error(
            "Toast job ingestion failed event_id=%s crm_job_id=%s: %s",
            event_id,
            normalized["crm_job_id"],
            exc,
        )
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("event_id", event_id)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=500, detail="Failed to ingest job")

    logger.info(
        "Toast order ingested job_id=%s crm_job_id=%s tenant_id=%s",
        job_id,
        normalized["crm_job_id"],
        tenant_id,
    )

    # 8. Enqueue processing
    trigger_payload = {"webhook_event_id": event_id, "job_id": job_id, "tenant_id": tenant_id}

    from app.core.trigger_client import trigger_task

    run_id = await trigger_task(
        task_id="process-toast-webhook",
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
            {"status": "complete", "processed_at": "now()"}
        ).eq("id", event_id).eq("tenant_id", tenant_id).execute()
        return {
            "received": True,
            "action": "queued_celery",
            "job_id": job_id,
            "task_id": task.id,
        }
    except Exception as exc:
        logger.error("Celery fallback failed for Toast job_id=%s: %s", job_id, exc)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("job_id", job_id)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        return {
            "received": True,
            "action": "stored_pending_batch",
            "job_id": job_id,
        }


def _safe_event_type(payload: dict) -> str:
    return (
        payload.get("eventType")
        or payload.get("event_type")
        or payload.get("type")
        or "order.complete"
    )
