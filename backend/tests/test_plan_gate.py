"""Tests for plan_gate — plan-gated feature enforcement."""
import pytest
from unittest.mock import MagicMock, patch
from app.core.plan_gate import (
    check_job_quota,
    check_feature,
    get_usage,
    PlanLimitExceeded,
    PLAN_JOB_LIMITS,
    PLAN_FEATURES,
)


def _mock_db(plan="starter", sub_status="active", used_count=0):
    """Create a mock DB that returns tenant + usage data."""
    db = MagicMock()

    # tenants table mock
    tenant_result = MagicMock()
    tenant_result.data = {"plan": plan, "subscription_status": sub_status}
    tenant_chain = MagicMock()
    tenant_chain.execute.return_value = tenant_result
    tenant_chain.single.return_value = tenant_chain
    tenant_chain.eq.return_value = tenant_chain

    # reconciliation_results count mock
    count_result = MagicMock()
    count_result.count = used_count
    count_result.data = []
    count_chain = MagicMock()
    count_chain.execute.return_value = count_result
    count_chain.gte.return_value = count_chain
    count_chain.eq.return_value = count_chain
    count_chain.select.return_value = count_chain

    def table_side_effect(name):
        if name == "tenants":
            mock = MagicMock()
            mock.select.return_value = tenant_chain
            return mock
        elif name == "reconciliation_results":
            return count_chain
        return MagicMock()

    db.table.side_effect = table_side_effect
    return db


def test_starter_plan_allows_under_limit():
    db = _mock_db(plan="starter", used_count=10)
    result = check_job_quota(db, "tenant-1")
    assert result["allowed"] is True
    assert result["plan"] == "starter"
    assert result["used"] == 10
    assert result["limit"] == 50
    assert result["remaining"] == 40


def test_starter_plan_blocks_at_limit():
    db = _mock_db(plan="starter", used_count=50)
    with pytest.raises(PlanLimitExceeded) as exc_info:
        check_job_quota(db, "tenant-1")
    assert exc_info.value.used == 50
    assert exc_info.value.limit == 50


def test_enterprise_plan_effectively_unlimited():
    db = _mock_db(plan="enterprise", used_count=5000)
    result = check_job_quota(db, "tenant-1")
    assert result["allowed"] is True
    assert result["remaining"] > 0


def test_cancelled_subscription_blocked():
    db = _mock_db(plan="starter", sub_status="cancelled", used_count=0)
    with pytest.raises(PlanLimitExceeded):
        check_job_quota(db, "tenant-1")


def test_check_feature_starter_has_basic_parse():
    db = _mock_db(plan="starter")
    assert check_feature(db, "tenant-1", "basic_parse") is True


def test_check_feature_starter_lacks_photo_ai():
    db = _mock_db(plan="starter")
    assert check_feature(db, "tenant-1", "photo_ai") is False


def test_check_feature_growth_has_photo_ai():
    db = _mock_db(plan="growth")
    assert check_feature(db, "tenant-1", "photo_ai") is True


def test_check_feature_enterprise_has_webhooks():
    db = _mock_db(plan="enterprise")
    assert check_feature(db, "tenant-1", "webhooks") is True


def test_get_usage_returns_correct_structure():
    db = _mock_db(plan="growth", used_count=100)
    usage = get_usage(db, "tenant-1")
    assert usage["plan"] == "growth"
    assert usage["jobs_used"] == 100
    assert usage["jobs_limit"] == 250
    assert usage["jobs_remaining"] == 150
    assert usage["usage_pct"] == 40.0
    assert "photo_ai" in usage["features"]


def test_plan_limit_exceeded_message():
    exc = PlanLimitExceeded("t-1", "starter", 50, 50)
    assert "50/50" in str(exc)
    assert "starter" in str(exc)
