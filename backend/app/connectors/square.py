"""Square POS webhook receiver.

Receives ``order.completed`` / ``payment.completed`` events from Square,
verifies the HMAC-SHA256 signature, normalizes the payload, durably stores
the event, then enqueues field-note parsing.

Square webhook docs:
    https://developer.squareup.com/docs/webhooks/overview

Environment variables
---------------------
SQUARE_WEBHOOK_SECRET   HMAC-SHA256 signing key from Square Developer Dashboard.
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
from app.connectors.webhook_normalizer import normalize_square
from app.connectors.job_ingestion import ingest_normalized_job as _ingest_normalized_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/square", tags=["webhooks"])

_SECRET_ENV = "SQUARE_WEBHOOK_SECRET"


# ── Signature verification ────────────────────────────────────────────────────

def _verify_signature(
    body: bytes,
    signature: str,
    secret: str,
    notification_url: str,
) -> bool:
    """Verify Square webhook HMAC-SHA256 signature.

    Square concatenates the notification URL + raw body, then HMAC-SHA256s
    the result with the signing key, and Base64-encodes it.
    """
    import base64
    combined = notification_url.encode() + body
    expected = base64.b64encode(
        hmac.new(secret.encode(), combined, hashlib.sha256).digest()  # type: ignore[attr-defined]
    ).decode()
    return hmac.compare_digest(expected, signature)


# ── Webhook endpoint ──────────────────────────────────────────────────────────

@router.post("/order-complete")
async def receive_square_order_complete(
    request: Request,
    x_square_hmacsha256_signature: Optional[str] = Header(
        None, alias="X-Square-Hmacsha256-Signature"
    ),
    db=Depends(get_supabase),
) -> dict:
    """Receive a Square ``order.completed`` or ``payment.completed`` webhook.

    Returns 200 immediately — all heavy processing is async.
    """
    body_bytes = await request.body()

    # 1. Signature verification
    secret = os.getenv(_SECRET_ENV, "")
    if secret:
        sig = x_square_hmacsha256_signature or ""
        notification_url = str(request.url)
        if not sig or not _verify_signature(body_bytes, sig, secret, notification_url):
            logger.warning(
                "Square signature mismatch — client=%s sig=%s",
                request.client,
                x_square_hmacsha256_signature,
            )
            raise HTTPException(status_code=401, detail="Invalid webhook signature")
    else:
        logger.warning(
            "%s not set — skipping Square signature check (dev mode)", _SECRET_ENV
        )

    # 2. Parse JSON
    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # 3. Resolve tenant via X-Tenant-ID header or merchant_id lookup
    tenant_id: Optional[str] = request.headers.get("X-Tenant-ID")
    if not tenant_id:
        merchant_id = payload.get("merchant_id")
        if merchant_id:
            tenant_res = (
                db.table("tenants")
                .select("id")
                .eq("crm_account_id", str(merchant_id))
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
        payload.get("event_id")
        or request.headers.get("X-Request-Id")
        or str(uuid_mod.uuid4())
    )
    idempotency_key = f"square-{delivery_id}"

    event_type = payload.get("type") or "order.completed"

    # 5. Durably store raw event
    try:
        insert_res = (
            db.table("webhook_events")
            .insert(
                {
                    "source": "square",
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
            logger.info("Duplicate Square event %s — already processed", idempotency_key)
            return {"received": True, "action": "duplicate_ignored"}
        logger.error("Failed to store Square webhook event: %s", exc)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("idempotency_key", idempotency_key)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    if not event_id:
        raise HTTPException(status_code=500, detail="Failed to store webhook event")

    # 6. Normalize payload
    try:
        normalized = normalize_square(payload, tenant_id)
    except Exception as exc:
        logger.error("Square payload normalization failed event_id=%s: %s", event_id, exc)
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
            "Square job ingestion failed event_id=%s crm_job_id=%s: %s",
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
        "Square order ingested job_id=%s crm_job_id=%s tenant_id=%s",
        job_id,
        normalized["crm_job_id"],
        tenant_id,
    )

    # 8. Enqueue processing
    trigger_payload = {"webhook_event_id": event_id, "job_id": job_id, "tenant_id": tenant_id}

    from app.core.trigger_client import trigger_task

    run_id = await trigger_task(
        task_id="process-square-webhook",
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
        logger.error("Celery fallback failed for Square job_id=%s: %s", job_id, exc)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("job_id", job_id)
            scope.set_tag("tenant_id", tenant_id)
            sentry_sdk.capture_exception(exc)
        return {
            "received": True,
            "action": "stored_pending_batch",
            "job_id": job_id,
        }
