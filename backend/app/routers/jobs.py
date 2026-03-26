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
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user: dict = Security(get_current_user),
):
    """List jobs for the authenticated tenant with optional filtering and pagination."""
    supabase = get_supabase()
    query = (
        supabase.table("jobs")
        .select("*, field_notes(parse_status), reconciliation_results(status, estimated_leak_cents)", count="exact")
        .eq("tenant_id", user["tenant_id"])
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if status:
        query = query.eq("status", status)
    if search:
        query = query.ilike("crm_job_id", f"%{search}%")

    result = query.execute()
    total = result.count or 0
    return {
        "jobs": result.data or [],
        "count": len(result.data or []),
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total,
    }


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
    user: dict = Security(require_role("owner", "auditor")),
):
    """Approve a job invoice — marks it as approved, tenant-scoped."""
    supabase = get_supabase()

    # Atomic conditional update — only succeeds if job is in 'pending_invoice' state.
    # Requiring the exact status (not just "not frozen/approved") prevents races
    # where the alert engine freezes the job between our check and the update.
    result = (
        supabase.table("jobs")
        .update({"status": "approved"})
        .eq("id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .eq("status", "pending_invoice")
        .execute()
    )

    if not result.data:
        # Fetch to return a precise error — could be 404, frozen, or already approved
        fetch = (
            supabase.table("jobs")
            .select("id, status")
            .eq("id", str(job_id))
            .eq("tenant_id", user["tenant_id"])
            .single()
            .execute()
        )
        if not fetch.data:
            raise HTTPException(status_code=404, detail="Job not found")
        if fetch.data["status"] == "approved":
            raise HTTPException(status_code=409, detail="Job already approved")
        if fetch.data["status"] == "frozen":
            raise HTTPException(
                status_code=409,
                detail="Job is frozen due to revenue leak alert — resolve discrepancies first",
            )
        raise HTTPException(
            status_code=409,
            detail=f"Job cannot be approved in status '{fetch.data['status']}'",
        )

    from app.core.audit_log import log_action
    log_action(
        tenant_id=user["tenant_id"],
        actor_id=user["user_id"],
        action="job.approved",
        entity_type="job",
        entity_id=str(job_id),
    )

    sentry_sdk.set_context("job_approval", {
        "job_id": str(job_id),
        "tenant_id": user["tenant_id"],
        "approved_by": user["user_id"],
    })

    return {"approved": True, "job_id": str(job_id)}


@router.post("/{job_id}/parse")
async def trigger_parse(
    job_id: UUID,
    user: dict = Security(require_role("owner", "auditor")),
):
    """Manually trigger field-note parsing for a job (re-queue Celery task)."""
    supabase = get_supabase()
    fetch = (
        supabase.table("jobs")
        .select("id, tenant_id")
        .eq("id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .single()
        .execute()
    )
    if not fetch.data:
        raise HTTPException(status_code=404, detail="Job not found")

    from app.workers.tasks import process_field_notes
    task = process_field_notes.delay(str(job_id), user["tenant_id"])
    return {"queued": True, "task_id": task.id, "job_id": str(job_id)}


@router.get("/{job_id}/reconciliation")
async def get_reconciliation(
    job_id: UUID,
    user: dict = Security(get_current_user),
):
    """Return the latest reconciliation result for a job."""
    supabase = get_supabase()
    result = (
        supabase.table("reconciliation_results")
        .select("*")
        .eq("job_id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .order("run_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No reconciliation result found")
    return result.data[0]
