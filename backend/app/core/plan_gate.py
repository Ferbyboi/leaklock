"""Plan-gated feature enforcement for the parse pipeline.

Checks the tenant's current plan before allowing expensive operations
(e.g., Sonnet parsing, photo AI, embedding generation).

Plan limits
-----------
  starter:    50 jobs/month,  no photo AI, no embeddings
  growth:     250 jobs/month, photo AI, embeddings
  enterprise: unlimited
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

PLAN_JOB_LIMITS: dict[str, int] = {
    "starter": 50,
    "growth": 250,
    "pro": 250,  # legacy alias
    "enterprise": 999999,
}

PLAN_FEATURES: dict[str, set[str]] = {
    "starter": {"basic_parse", "sms_alerts", "email_alerts"},
    "growth": {"basic_parse", "sms_alerts", "email_alerts", "photo_ai", "embeddings", "reports", "export"},
    "pro": {"basic_parse", "sms_alerts", "email_alerts", "photo_ai", "embeddings", "reports", "export"},
    "enterprise": {
        "basic_parse", "sms_alerts", "email_alerts", "photo_ai",
        "embeddings", "reports", "export", "webhooks", "api_keys", "sso",
    },
}


class PlanLimitExceeded(Exception):
    """Raised when a tenant has exceeded their plan's job limit."""

    def __init__(self, tenant_id: str, plan: str, used: int, limit: int):
        self.tenant_id = tenant_id
        self.plan = plan
        self.used = used
        self.limit = limit
        super().__init__(
            f"Tenant {tenant_id} on '{plan}' plan: {used}/{limit} jobs used this month"
        )


def check_job_quota(db, tenant_id: str) -> dict:
    """Check if the tenant can process another job this month.

    Returns dict with keys: allowed, plan, used, limit, remaining.
    Raises PlanLimitExceeded if over quota.
    """
    # Fetch tenant plan
    tenant_res = (
        db.table("tenants")
        .select("plan, subscription_status")
        .eq("id", tenant_id)
        .single()
        .execute()
    )
    tenant = tenant_res.data or {}
    plan = tenant.get("plan", "starter")
    sub_status = tenant.get("subscription_status", "active")

    # Block cancelled/past_due tenants
    if sub_status in ("cancelled", "unpaid"):
        raise PlanLimitExceeded(tenant_id, plan, 0, 0)

    limit = PLAN_JOB_LIMITS.get(plan, 50)

    # Count jobs processed this calendar month
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    count_res = (
        db.table("reconciliation_results")
        .select("id", count="exact")
        .eq("tenant_id", tenant_id)
        .gte("run_at", month_start)
        .execute()
    )
    used = count_res.count or 0

    if used >= limit:
        raise PlanLimitExceeded(tenant_id, plan, used, limit)

    return {
        "allowed": True,
        "plan": plan,
        "used": used,
        "limit": limit,
        "remaining": limit - used,
    }


def check_feature(db, tenant_id: str, feature: str) -> bool:
    """Check if a feature is available on the tenant's plan.

    Returns True if allowed, False otherwise.
    """
    tenant_res = (
        db.table("tenants")
        .select("plan")
        .eq("id", tenant_id)
        .single()
        .execute()
    )
    plan = (tenant_res.data or {}).get("plan", "starter")
    allowed_features = PLAN_FEATURES.get(plan, PLAN_FEATURES["starter"])
    return feature in allowed_features


def get_usage(db, tenant_id: str) -> dict:
    """Return current month usage stats for billing display."""
    from datetime import datetime, timezone

    tenant_res = (
        db.table("tenants")
        .select("plan, subscription_status")
        .eq("id", tenant_id)
        .single()
        .execute()
    )
    tenant = tenant_res.data or {}
    plan = tenant.get("plan", "starter")
    limit = PLAN_JOB_LIMITS.get(plan, 50)

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    count_res = (
        db.table("reconciliation_results")
        .select("id", count="exact")
        .eq("tenant_id", tenant_id)
        .gte("run_at", month_start)
        .execute()
    )
    used = count_res.count or 0

    return {
        "plan": plan,
        "subscription_status": tenant.get("subscription_status", "active"),
        "jobs_used": used,
        "jobs_limit": limit,
        "jobs_remaining": max(0, limit - used),
        "usage_pct": round((used / limit) * 100, 1) if limit > 0 else 0,
        "features": list(PLAN_FEATURES.get(plan, PLAN_FEATURES["starter"])),
    }
