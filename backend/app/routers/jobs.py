import os
import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, Security, status
from typing import Optional
from uuid import UUID

from app.auth import get_current_user, require_role, get_supabase

router = APIRouter()


@router.get("")
async def list_jobs(
    status: Optional[str] = None,
    user: dict = Security(get_current_user),
):
    """List all jobs for the authenticated tenant."""
    supabase = get_supabase()
    query = (
        supabase.table("jobs")
        .select("*, field_notes(*), draft_invoices(*)")
        .eq("tenant_id", user["tenant_id"])
        .order("created_at", desc=True)
    )
    if status:
        query = query.eq("status", status)

    result = query.execute()
    return {"jobs": result.data, "count": len(result.data)}


@router.get("/{job_id}")
async def get_job(
    job_id: UUID,
    user: dict = Security(get_current_user),
):
    """Get a single job by ID — tenant-scoped."""
    supabase = get_supabase()
    result = (
        supabase.table("jobs")
        .select("*, field_notes(*), draft_invoices(*), reconciliation_results(*)")
        .eq("id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return result.data


@router.post("/{job_id}/approve")
async def approve_job(
    job_id: UUID,
    user: dict = Security(require_role("admin", "manager")(get_current_user)),
):
    """Approve a job invoice — marks it as approved, tenant-scoped."""
    supabase = get_supabase()

    # Fetch job first to verify ownership and current status
    fetch = (
        supabase.table("jobs")
        .select("id, status, tenant_id")
        .eq("id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .single()
        .execute()
    )
    if not fetch.data:
        raise HTTPException(status_code=404, detail="Job not found")

    job = fetch.data
    if job["status"] == "approved":
        raise HTTPException(status_code=409, detail="Job already approved")

    if job["status"] == "frozen":
        raise HTTPException(
            status_code=409,
            detail="Job is frozen due to revenue leak alert — resolve discrepancies first",
        )

    # Update status → approved
    result = (
        supabase.table("jobs")
        .update({"status": "approved"})
        .eq("id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .execute()
    )

    sentry_sdk.set_context("job_approval", {
        "job_id": str(job_id),
        "tenant_id": user["tenant_id"],
        "approved_by": user["user_id"],
    })

    return {"approved": True, "job_id": str(job_id)}
