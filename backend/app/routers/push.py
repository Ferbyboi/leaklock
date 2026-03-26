"""Web Push (VAPID) subscription management.

Endpoints
---------
POST   /push/subscribe     — Register a push subscription for the authenticated user
DELETE /push/unsubscribe    — Remove a push subscription
GET    /push/vapid-key      — Return the public VAPID key for the frontend

Environment variables
---------------------
VAPID_PUBLIC_KEY    Base64-encoded public key (shared with frontend)
VAPID_PRIVATE_KEY   Base64-encoded private key (server-only)
VAPID_CLAIM_EMAIL   Contact email for VAPID (e.g., mailto:admin@leaklock.io)
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

import sentry_sdk
from fastapi import APIRouter, HTTPException, Security, status
from pydantic import BaseModel

from app.auth import get_current_user, get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class PushSubscriptionResponse(BaseModel):
    success: bool
    id: Optional[str] = None


@router.get("/push/vapid-key")
async def get_vapid_key():
    """Return the public VAPID key for the frontend to subscribe."""
    key = os.getenv("VAPID_PUBLIC_KEY", "")
    if not key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web Push not configured — VAPID_PUBLIC_KEY not set",
        )
    return {"vapid_public_key": key}


@router.post("/push/subscribe", response_model=PushSubscriptionResponse)
async def subscribe_push(
    body: PushSubscriptionRequest,
    user: dict = Security(get_current_user),
):
    """Register a push subscription endpoint for the authenticated user."""
    supabase = get_supabase()
    tenant_id = user["tenant_id"]
    user_id = user["sub"]

    try:
        result = (
            supabase.table("push_subscriptions")
            .upsert(
                {
                    "tenant_id": tenant_id,
                    "user_id": user_id,
                    "endpoint": body.endpoint,
                    "p256dh": body.p256dh,
                    "auth": body.auth,
                },
                on_conflict="user_id,endpoint",
            )
            .execute()
        )
        sub_id = (result.data or [{}])[0].get("id")
        return PushSubscriptionResponse(success=True, id=sub_id)

    except Exception as exc:
        logger.error("Failed to save push subscription: %s", exc)
        sentry_sdk.capture_exception(exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save push subscription",
        )


@router.delete("/push/unsubscribe")
async def unsubscribe_push(
    body: PushSubscriptionRequest,
    user: dict = Security(get_current_user),
):
    """Remove a push subscription for the authenticated user."""
    supabase = get_supabase()

    try:
        supabase.table("push_subscriptions").delete().eq(
            "user_id", user["sub"]
        ).eq("endpoint", body.endpoint).execute()
        return {"success": True}

    except Exception as exc:
        logger.error("Failed to remove push subscription: %s", exc)
        sentry_sdk.capture_exception(exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove push subscription",
        )
