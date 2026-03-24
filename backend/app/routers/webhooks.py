import os
import httpx
from fastapi import APIRouter, Request, HTTPException, Header
from pydantic import BaseModel, field_validator
from typing import Optional
import hashlib, hmac

router = APIRouter()

TRIGGER_API_KEY = os.getenv("TRIGGER_API_KEY")
TRIGGER_API_URL = os.getenv("TRIGGER_API_URL", "https://api.trigger.dev")


async def send_trigger_event(name: str, payload: dict):
    """Fire an event to Trigger.dev."""
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
        return r.json()


class GenericWebhookPayload(BaseModel):
    crm_job_id:   str
    tenant_id:    str
    client_name:  str
    tech_notes:   Optional[str] = None
    photo_urls:   Optional[list[str]] = None
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
    """Generic webhook — accepts JobCompletedPayload directly."""
    await send_trigger_event("webhook.generic", payload.model_dump())
    return {"received": True, "crm_job_id": payload.crm_job_id}
