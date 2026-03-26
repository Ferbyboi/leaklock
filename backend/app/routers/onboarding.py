"""Tenant onboarding — creates tenant record and provisions user app_metadata."""
import sentry_sdk
import jwt
from fastapi import APIRouter, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from typing import Optional

from app.auth import get_supabase, _decode_token

router = APIRouter()
security = HTTPBearer()


class OnboardRequest(BaseModel):
    company_name: str = ""
    tenant_type: Optional[str] = None
    location_name: str = ""
    location_address: str = ""

    @property
    def resolved_name(self) -> str:
        return self.company_name or self.location_name or "My Business"


@router.post("/onboard")
async def onboard_tenant(
    body: OnboardRequest,
    credentials: HTTPAuthorizationCredentials = Security(security),
):
    """
    Called immediately after Supabase signUp().
    Creates tenant row + sets app_metadata (tenant_id, user_role=owner).
    Frontend must call supabase.auth.refreshSession() after this to pick up new claims.
    """
    token = credentials.credentials
    try:
        payload = _decode_token(token)
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    # Idempotency — user already onboarded
    app_meta = payload.get("app_metadata") or {}
    existing_tenant_id = payload.get("tenant_id") or app_meta.get("tenant_id")
    if existing_tenant_id:
        return {"tenant_id": existing_tenant_id, "already_onboarded": True}

    supabase = get_supabase()

    tenant_data: dict = {"name": body.resolved_name}
    if body.tenant_type:
        tenant_data["tenant_type"] = body.tenant_type

    # Create tenant row
    tenant_res = (
        supabase.table("tenants")
        .insert(tenant_data)
        .execute()
    )
    if not tenant_res.data:
        raise HTTPException(status_code=500, detail="Failed to create tenant")

    tenant_id = tenant_res.data[0]["id"]

    # Create first location if address was provided
    if body.location_name or body.location_address:
        try:
            supabase.table("locations").insert({
                "tenant_id": tenant_id,
                "name": body.location_name or body.resolved_name,
                "address": body.location_address or None,
            }).execute()
        except Exception:
            pass  # Non-fatal — tenant was created successfully

    # Set app_metadata on the Supabase user via Admin API
    supabase.auth.admin.update_user_by_id(
        user_id,
        {"app_metadata": {"tenant_id": tenant_id, "user_role": "owner"}},
    )

    sentry_sdk.set_context("onboarding", {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "company_name": body.resolved_name,
        "tenant_type": body.tenant_type,
    })

    return {"tenant_id": tenant_id, "company_name": body.resolved_name}
