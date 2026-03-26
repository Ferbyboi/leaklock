"""Trigger.dev task definitions for Jobber webhook processing.

These tasks run on Trigger.dev's managed infrastructure and are retried
automatically on failure. They read from `webhook_events` and call the
existing Celery task chain.

Deploy: `npx trigger.dev@latest deploy` (or configure in Railway).
Env vars required: TRIGGER_API_KEY, TRIGGER_PROJECT_ID, plus all standard
LeakLock backend vars.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Trigger.dev v3 Python SDK — tasks execute on Trigger.dev infrastructure.
# Install: pip install triggerdotdev
try:
    from triggerdotdev import task, logger as trigger_logger
    _TRIGGER_AVAILABLE = True
except ImportError:
    _TRIGGER_AVAILABLE = False
    # Graceful degradation — Celery handles processing when SDK not installed.
    def task(id: str, **kwargs):  # type: ignore[misc]
        def decorator(fn):
            return fn
        return decorator


@task(id="process-jobber-webhook", max_duration=300, retry={"maxAttempts": 5, "factor": 2, "minTimeoutInMs": 30000})
async def process_jobber_webhook(payload: dict) -> dict:
    """Durable Trigger.dev task: process a stored Jobber webhook event.

    Reads the event from webhook_events by ID, runs the full processing
    pipeline (normalize → upsert → Celery parse chain), and marks it complete.

    Retried up to 5 times with exponential back-off on any exception.
    """
    from app.db import get_db
    from app.workers.tasks import process_field_notes, run_three_way_match

    event_id: str = payload["webhook_event_id"]
    db = get_db()

    # Claim the event atomically
    claim = (
        db.table("webhook_events")
        .update({"status": "processing"})
        .eq("id", event_id)
        .eq("status", "received")
        .execute()
    )
    if not (claim.data):
        return {"skipped": True, "reason": "already_processing_or_complete"}

    try:
        row = claim.data[0]
        raw = row["raw_payload"]
        tenant_id = row["tenant_id"]

        event_type = raw.get("webHookEvent") or raw.get("event", "")
        data = raw.get("data") or {}

        from app.routers.webhooks_jobber import normalize_jobber_payload
        normalized = normalize_jobber_payload(event_type, data, tenant_id)
        if not normalized:
            db.table("webhook_events").update({
                "status": "complete",
                "processed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", event_id).execute()
            return {"skipped": True, "reason": "unactionable_event"}

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
            raise ValueError("Failed to upsert job")

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
            task_handle = process_field_notes.delay(job_id, tenant_id)
            action = f"queued_parse:{task_handle.id}"
        elif "INVOICE" in event_type.upper():
            if normalized.invoice_items:
                db.table("draft_invoices").upsert({
                    "tenant_id": tenant_id,
                    "job_id": job_id,
                    "line_items": [i.model_dump() for i in normalized.invoice_items],
                }, on_conflict="tenant_id,job_id").execute()
            task_handle = run_three_way_match.delay(job_id, tenant_id)
            action = f"queued_match:{task_handle.id}"
        else:
            action = "no_action"

        db.table("webhook_events").update({
            "status": "complete",
            "processed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", event_id).execute()
        return {"success": True, "job_id": job_id, "action": action}

    except Exception as exc:
        db.table("webhook_events").update({
            "status": "failed",
            "error_message": str(exc)[:500],
        }).eq("id", event_id).execute()
        raise  # Let Trigger.dev retry


@task(id="replay-failed-webhooks", max_duration=120)
async def replay_failed_webhooks(payload: dict) -> dict:
    """Re-enqueue all failed webhook events for reprocessing.

    Useful after an extended outage. Triggered manually from the dashboard
    or via Trigger.dev's scheduled task feature.
    """
    from app.core.trigger_client import trigger_task
    from app.db import get_db

    db = get_db()
    result = (
        db.table("webhook_events")
        .select("id")
        .eq("status", "failed")
        .order("received_at", desc=False)
        .limit(100)
        .execute()
    )
    events = result.data or []
    replayed = 0
    for evt in events:
        # Reset to received so process_jobber_webhook can claim it
        db.table("webhook_events").update({"status": "received", "error_message": None}).eq("id", evt["id"]).execute()
        await trigger_task("process-jobber-webhook", {"webhook_event_id": evt["id"]}, idempotency_key=f"replay-{evt['id']}")
        replayed += 1

    return {"replayed": replayed}
