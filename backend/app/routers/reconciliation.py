"""Reconciliation review routes — auditor actions on match results."""
import sentry_sdk
from fastapi import APIRouter, HTTPException, Security
from pydantic import BaseModel
from typing import Literal
from uuid import UUID

from app.auth import get_current_user, require_role, get_supabase

router = APIRouter()


class AuditorAction(BaseModel):
    action: Literal["confirm_leak", "false_positive", "override_approve"]
    note: str = ""


@router.post("/jobs/{job_id}/reconciliation/{result_id}/review")
async def review_reconciliation(
    job_id: UUID,
    result_id: UUID,
    body: AuditorAction,
    user: dict = Security(require_role("owner", "auditor")),
):
    """
    Auditor reviews a reconciliation result.
    - confirm_leak: escalate, keep invoice frozen
    - false_positive: unfreeze invoice, track in PostHog KPI
    - override_approve: admin override — approve despite discrepancy
    """
    supabase = get_supabase()

    # Verify result belongs to tenant
    result = (
        supabase.table("reconciliation_results")
        .select("id, job_id, tenant_id, status")
        .eq("id", str(result_id))
        .eq("job_id", str(job_id))
        .eq("tenant_id", user["tenant_id"])
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Reconciliation result not found")

    # Map auditor action to reconciliation_results status value
    _ACTION_TO_STATUS = {
        "false_positive": "false_positive",
        "override_approve": "override_approved",
        "confirm_leak": "confirmed",
    }

    # Update reconciliation result with auditor action + status
    new_status = _ACTION_TO_STATUS.get(body.action, result.data["status"])
    supabase.table("reconciliation_results").update({
        "status": new_status,
        "auditor_action": body.action,
        "auditor_id": user["user_id"],
        "reviewed_at": "now()",
    }).eq("id", str(result_id)).eq("tenant_id", user["tenant_id"]).execute()

    # Act on the job based on decision
    if body.action == "false_positive":
        supabase.table("jobs").update({
            "status": "pending_invoice",
            "match_status": "false_positive",
        }).eq("id", str(job_id)).eq("tenant_id", user["tenant_id"]).execute()

        # Track false positive for KPI monitoring
        from app.core.alert_engine import track_false_positive
        track_false_positive(user["tenant_id"], str(job_id), user["user_id"])

    elif body.action == "override_approve":
        if user["role"] not in ("owner",):
            raise HTTPException(status_code=403, detail="Only admins can override-approve")
        supabase.table("jobs").update({
            "status": "approved",
            "match_status": "override",
        }).eq("id", str(job_id)).eq("tenant_id", user["tenant_id"]).execute()

    # confirm_leak: no status change — job stays frozen

    # Audit log — append-only record of the review
    from app.core.audit_log import log_action
    log_action(
        tenant_id=user["tenant_id"],
        actor_id=user["user_id"],
        action=f"reconciliation.{body.action}",
        entity_type="reconciliation_result",
        entity_id=str(result_id),
        metadata={"job_id": str(job_id), "note": body.note},
    )

    sentry_sdk.set_context("auditor_review", {
        "job_id": str(job_id),
        "result_id": str(result_id),
        "action": body.action,
        "auditor_id": user["user_id"],
    })

    return {"reviewed": True, "action": body.action, "job_id": str(job_id)}


@router.get("/reconciliation/dashboard")
async def reconciliation_dashboard(
    user: dict = Security(require_role("owner", "auditor")),
):
    """
    Auditor dashboard — all unreviewed discrepancies for this tenant.
    Sorted by estimated_leak_cents descending (highest value first).
    """
    supabase = get_supabase()
    results = (
        supabase.table("reconciliation_results")
        .select("*, jobs(crm_job_id, status, created_at)")
        .eq("tenant_id", user["tenant_id"])
        .eq("status", "discrepancy")
        .is_("auditor_action", "null")
        .order("estimated_leak_cents", desc=True)
        .execute()
    )
    total_leak = sum(r["estimated_leak_cents"] for r in (results.data or []))
    return {
        "unreviewed_count": len(results.data or []),
        "total_unreviewed_leak_cents": total_leak,
        "results": results.data or [],
    }
