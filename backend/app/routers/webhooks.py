import os
import logging
import httpx
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.db import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

TRIGGER_API_KEY = os.getenv("TRIGGER_API_KEY")
TRIGGER_API_URL = os.getenv("TRIGGER_API_URL", "https://api.trigger.dev")


async def send_trigger_event(name: str, payload: dict) -> bool:
    """Fire an event to Trigger.dev. Returns True on success, False on failure."""
    if not TRIGGER_API_KEY:
        logger.warning("TRIGGER_API_KEY not set — skipping Trigger.dev")
        return False
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{TRIGGER_API_URL}/api/v1/events",
                headers={
                    "Authorization": f"Bearer {TRIGGER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"name": name, "payload": payload},
                timeout=10,
            )
            r.raise_for_status()
            return True
    except Exception as exc:
        logger.error("Trigger.dev call failed: %s", exc)
        return False


def _ingest_job(payload_dict: dict) -> str:
    """
    Directly ingest a normalized job into Supabase and queue Celery parsing.
    Returns the internal job UUID.
    """
    db = get_db()

    crm_job_id   = payload_dict["crm_job_id"]
    tenant_id    = payload_dict["tenant_id"]
    tech_notes   = payload_dict.get("tech_notes")
    photo_urls   = payload_dict.get("photo_urls") or []
    draft_invoice = payload_dict.get("draft_invoice")

    # 1. Upsert job record
    job_res = (
        db.table("jobs")
        .upsert({
            "crm_job_id":    crm_job_id,
            "tenant_id":     tenant_id,
            "status":        "pending_invoice",
            "match_status":  "pending",
        })
        .execute()
    )
    if not job_res.data:
        raise RuntimeError(f"Failed to upsert job {crm_job_id}")
    job_id = job_res.data[0]["id"]

    # 2. Store field notes
    db.table("field_notes").insert({
        "job_id":       job_id,
        "tenant_id":    tenant_id,
        "raw_text":     tech_notes,
        "photo_urls":   photo_urls if photo_urls else None,
        "parse_status": "pending",
    }).execute()

    # 3. Store draft invoice if provided
    if draft_invoice and draft_invoice.get("line_items"):
        db.table("draft_invoices").insert({
            "job_id":     job_id,
            "tenant_id":  tenant_id,
            "line_items": draft_invoice["line_items"],
        }).execute()

    # 4. Queue Celery parse task
    try:
        from app.workers.tasks import process_field_notes
        process_field_notes.delay(job_id, tenant_id)
    except Exception as exc:
        logger.error("Failed to queue Celery task: %s", exc)

    return job_id


class GenericWebhookPayload(BaseModel):
    crm_job_id:    str
    tenant_id:     str
    client_name:   str
    tech_notes:    Optional[str] = None
    photo_urls:    Optional[list[str]] = None
    draft_invoice: Optional[dict] = None


@router.post("/webhooks/jobber")
async def jobber_webhook(request: Request):
    """Receive Jobber webhook and forward to Trigger.dev."""
    body = await request.json()
    tenant_id = request.headers.get("X-Tenant-ID")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Missing X-Tenant-ID header")

    await send_trigger_event("webhook.jobber", {**body, "tenantId": tenant_id})
    return {"received": True}


@router.post("/webhooks/servicetitan")
async def servicetitan_webhook(request: Request):
    """Receive ServiceTitan webhook and forward to Trigger.dev."""
    body = await request.json()
    tenant_id = request.headers.get("X-Tenant-ID")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Missing X-Tenant-ID header")

    await send_trigger_event("webhook.servicetitan", {**body, "tenantId": tenant_id})
    return {"received": True}


@router.post("/webhooks/generic")
async def generic_webhook(payload: GenericWebhookPayload):
    """Generic webhook — directly ingests job into Supabase and queues Celery."""
    job_id = _ingest_job(payload.model_dump())
    return {"received": True, "crm_job_id": payload.crm_job_id, "job_id": job_id}
