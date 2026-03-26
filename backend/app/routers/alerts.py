"""Alerts endpoints — list and acknowledge revenue leak alerts."""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query, Security
from pydantic import BaseModel
from typing import Optional
from uuid import UUID

from app.auth import get_current_user, get_supabase

router = APIRouter()


class AcknowledgeBody(BaseModel):
    note: Optional[str] = None


@router.get("/alerts")
async def list_alerts(
    unread_only: bool = True,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: dict = Security(get_current_user),
):
    """List alerts for the current tenant with pagination.

    By default returns only unacknowledged alerts, sorted newest first.
    Pass unread_only=false to include already-acknowledged alerts.
    """
    supabase = get_supabase()
    query = (
        supabase.table("alerts")
        .select("id, title, severity, job_id, created_at, acknowledged_at", count="exact")
        .eq("tenant_id", user["tenant_id"])
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if unread_only:
        query = query.is_("acknowledged_at", "null")

    result = query.execute()
    rows = result.data or []
    total = result.count or 0
    return {
        "alerts":       rows,
        "total":        total,
        "limit":        limit,
        "offset":       offset,
        "has_more":     offset + limit < total,
        "unread_count": sum(1 for a in rows if not a.get("acknowledged_at")),
    }


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: UUID,
    body: AcknowledgeBody = AcknowledgeBody(),
    user: dict = Security(get_current_user),
):
    """Mark a single alert as acknowledged (read)."""
    supabase = get_supabase()

    # Verify ownership before updating
    existing = (
        supabase.table("alerts")
        .select("id, tenant_id, acknowledged_at")
        .eq("id", str(alert_id))
        .eq("tenant_id", user["tenant_id"])
        .single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Alert not found")

    supabase.table("alerts").update({
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", str(alert_id)).eq("tenant_id", user["tenant_id"]).execute()

    return {"acknowledged": True, "alert_id": str(alert_id)}


@router.post("/alerts/acknowledge-all")
async def acknowledge_all_alerts(user: dict = Security(get_current_user)):
    """Mark all unacknowledged alerts for this tenant as read."""
    supabase = get_supabase()
    supabase.table("alerts").update({
        "acknowledged_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", user["tenant_id"]).is_("acknowledged_at", "null").execute()

    return {"acknowledged_all": True}
