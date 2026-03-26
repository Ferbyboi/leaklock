"""Team management — invite technicians and auditors to a tenant."""
import os
import sentry_sdk
from fastapi import APIRouter, HTTPException, Security
from pydantic import BaseModel, EmailStr
from typing import Literal, Optional

from app.auth import get_current_user, require_role, get_supabase

router = APIRouter()


class InviteRequest(BaseModel):
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    role: Literal["tech", "auditor"] = "tech"


class InviteResponse(BaseModel):
    invited: bool
    channel: str  # "email" | "sms" | "none"
    message: str


@router.post("/team/invite", response_model=InviteResponse)
async def invite_team_member(
    body: InviteRequest,
    user: dict = Security(require_role("owner")),
):
    """Invite a field tech or auditor to join the tenant.

    - If email is provided: sends a Supabase magic-link invite email.
    - If only phone is provided: sends an SMS via Twilio with a sign-in link.
    - At least one of email/phone is required.

    Only owners can invite team members.
    """
    if not body.email and not body.phone:
        raise HTTPException(status_code=400, detail="Provide at least email or phone")

    tenant_id = user["tenant_id"]
    supabase = get_supabase()

    # Enforce seat limit
    tenant_res = (
        supabase.table("tenants")
        .select("seat_limit")
        .eq("id", tenant_id)
        .single()
        .execute()
    )
    seat_limit = (tenant_res.data or {}).get("seat_limit")
    if seat_limit is not None:
        current_count_res = (
            supabase.table("users")
            .select("id", count="exact")
            .eq("tenant_id", tenant_id)
            .neq("status", "removed")
            .execute()
        )
        current_count = current_count_res.count or 0
        if current_count >= seat_limit:
            raise HTTPException(
                status_code=402,
                detail=f"Seat limit reached ({seat_limit}). Upgrade your plan to add more team members.",
            )

    # Check if user already exists in this tenant
    if body.email:
        existing = (
            supabase.table("users")
            .select("id")
            .eq("email", body.email)
            .eq("tenant_id", tenant_id)
            .execute()
        )
        if existing.data:
            raise HTTPException(status_code=409, detail="User with this email already in your team")

    channel = "none"

    # Email invite via Supabase Admin
    if body.email:
        try:
            supabase.auth.admin.invite_user_by_email(
                body.email,
                options={
                    "data": {
                        "tenant_id": tenant_id,
                        "user_role": body.role,
                    }
                },
            )
            channel = "email"
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            raise HTTPException(status_code=500, detail=f"Failed to send invite email: {exc}")

    # SMS invite via Twilio (phone-only path)
    elif body.phone:
        twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
        twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
        twilio_from = os.getenv("TWILIO_FROM_NUMBER")
        frontend_url = os.getenv("FRONTEND_URL", "https://app.leaklock.io")

        if not twilio_sid:
            raise HTTPException(
                status_code=503,
                detail="SMS notifications not configured. Provide an email address instead.",
            )

        try:
            # Generate a one-time magic link for signup
            link_res = supabase.auth.admin.generate_link(
                {"type": "invite", "email": f"pending_{body.phone.replace('+', '')}@leaklock.invite"},
            )
            invite_link = (link_res.properties or {}).get("action_link", frontend_url + "/signup")

            from twilio.rest import Client as TwilioClient
            tw = TwilioClient(twilio_sid, twilio_token)
            tw.messages.create(
                body=(
                    f"You've been invited to join LeakLock as a {body.role}. "
                    f"Sign up here: {invite_link}"
                ),
                from_=twilio_from,
                to=body.phone,
            )
            channel = "sms"
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            raise HTTPException(status_code=500, detail=f"Failed to send SMS invite: {exc}")

    # Record the pending invite for audit trail
    try:
        supabase.table("users").insert({
            "tenant_id": tenant_id,
            "email":     body.email,
            "phone":     body.phone,
            "role":      body.role,
            "status":    "invited",
        }).execute()
    except Exception as exc:
        # Non-fatal — invite was sent; just log
        sentry_sdk.capture_exception(exc)

    return InviteResponse(
        invited=True,
        channel=channel,
        message=(
            f"Invite sent to {body.email or body.phone} via {channel}."
            if channel != "none"
            else "Invite recorded. Configure email/SMS to send notifications."
        ),
    )


@router.get("/team")
async def list_team_members(user: dict = Security(require_role("owner", "auditor"))):
    """List all users belonging to the current tenant."""
    supabase = get_supabase()
    result = (
        supabase.table("users")
        .select("id, email, phone, role, status, created_at")
        .eq("tenant_id", user["tenant_id"])
        .order("created_at", desc=False)
        .execute()
    )
    return {"members": result.data or []}


@router.delete("/team/{member_id}")
async def remove_team_member(
    member_id: str,
    user: dict = Security(require_role("owner")),
):
    """Remove a team member from the tenant (owner only).

    Cannot remove yourself.
    """
    if member_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")

    supabase = get_supabase()

    # Verify member belongs to same tenant
    member = (
        supabase.table("users")
        .select("id, tenant_id, role")
        .eq("id", member_id)
        .eq("tenant_id", user["tenant_id"])
        .single()
        .execute()
    )
    if not member.data:
        raise HTTPException(status_code=404, detail="Team member not found")

    supabase.table("users").update({"status": "removed"}) \
        .eq("id", member_id) \
        .eq("tenant_id", user["tenant_id"]) \
        .execute()

    from app.core.audit_log import log_action
    log_action(
        tenant_id=user["tenant_id"],
        actor_id=user["user_id"],
        action="member.removed",
        entity_type="user",
        entity_id=member_id,
        metadata={"removed_role": member.data.get("role")},
    )

    return {"removed": True, "member_id": member_id}
