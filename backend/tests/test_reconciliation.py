"""Tests for reconciliation review endpoints.

Covers:
- POST /jobs/{id}/reconciliation/{rid}/review — confirm_leak (owner)
- POST /jobs/{id}/reconciliation/{rid}/review — false_positive (auditor)
- POST /jobs/{id}/reconciliation/{rid}/review — override_approve (owner only)
- POST /jobs/{id}/reconciliation/{rid}/review — 403 when tech tries to review
- POST /jobs/{id}/reconciliation/{rid}/review — 403 when auditor tries override_approve
- POST /jobs/{id}/reconciliation/{rid}/review — 404 when result not found
- GET  /reconciliation/dashboard — returns unreviewed discrepancies
- GET  /reconciliation/dashboard — sums total leak correctly
- GET  /reconciliation/dashboard — empty when no discrepancies
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user

TENANT_ID = str(uuid.uuid4())
JOB_ID    = str(uuid.uuid4())
RESULT_ID = str(uuid.uuid4())
USER_ID   = str(uuid.uuid4())

_FAKE_TOKEN = jwt.encode({"sub": USER_ID}, "x", algorithm="HS256")
_AUTH       = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

_OWNER_USER = {
    "user_id":   USER_ID,
    "tenant_id": TENANT_ID,
    "role":      "owner",
    "email":     "owner@example.com",
}
_AUDITOR_USER = {**_OWNER_USER, "role": "auditor"}
_TECH_USER    = {**_OWNER_USER, "role": "tech"}

_RESULT_DATA = {
    "id":                     RESULT_ID,
    "job_id":                 JOB_ID,
    "tenant_id":              TENANT_ID,
    "status":                 "discrepancy",
    "estimated_leak_cents":   5000,
    "missing_items":          [{"item": "shutoff valve", "qty": 1, "estimated_leak_cents": 5000}],
    "auditor_action":         None,
    "reviewed_at":            None,
}

client = TestClient(app)


def _auth_as(user: dict):
    app.dependency_overrides[get_current_user] = lambda: user
    patch("app.auth.get_current_user", return_value=user).start()


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


def _make_review_sb(result_data=_RESULT_DATA):
    """Supabase mock for the review endpoint."""
    sb = MagicMock()
    # result lookup: .table().select().eq(id).eq(job_id).eq(tenant_id).single().execute()
    sb.table.return_value.select.return_value \
        .eq.return_value.eq.return_value.eq.return_value \
        .single.return_value.execute.return_value = MagicMock(data=result_data)
    # update calls
    sb.table.return_value.update.return_value.eq.return_value.eq.return_value \
        .execute.return_value = MagicMock(data={})
    sb.table.return_value.update.return_value.eq.return_value \
        .execute.return_value = MagicMock(data={})
    return sb


def _review(action: str, user=_OWNER_USER, result_data=_RESULT_DATA):
    _auth_as(user)
    sb = _make_review_sb(result_data)
    with patch("app.routers.reconciliation.get_supabase", return_value=sb), \
         patch("app.core.alert_engine.track_false_positive"):
        return client.post(
            f"/jobs/{JOB_ID}/reconciliation/{RESULT_ID}/review",
            json={"action": action, "note": "test"},
            headers=_AUTH,
        )


# ── Review actions ─────────────────────────────────────────────────────────────

def test_confirm_leak_returns_200():
    resp = _review("confirm_leak")
    assert resp.status_code == 200
    body = resp.json()
    assert body["reviewed"] is True
    assert body["action"] == "confirm_leak"
    assert body["job_id"] == JOB_ID


def test_false_positive_returns_200_for_auditor():
    resp = _review("false_positive", user=_AUDITOR_USER)
    assert resp.status_code == 200
    assert resp.json()["action"] == "false_positive"


def test_override_approve_allowed_for_owner():
    resp = _review("override_approve", user=_OWNER_USER)
    assert resp.status_code == 200
    assert resp.json()["action"] == "override_approve"


def test_override_approve_denied_for_auditor():
    """Auditors cannot override-approve — only owners can."""
    resp = _review("override_approve", user=_AUDITOR_USER)
    assert resp.status_code == 403


def test_review_denied_for_tech_role():
    """Tech role cannot access review endpoint (require_role owner/auditor)."""
    resp = _review("confirm_leak", user=_TECH_USER)
    assert resp.status_code == 403


def test_review_404_when_result_not_found():
    _auth_as(_OWNER_USER)
    sb = _make_review_sb(result_data=None)
    with patch("app.routers.reconciliation.get_supabase", return_value=sb):
        resp = client.post(
            f"/jobs/{JOB_ID}/reconciliation/{RESULT_ID}/review",
            json={"action": "confirm_leak"},
            headers=_AUTH,
        )
    assert resp.status_code == 404


def test_false_positive_calls_posthog_tracker():
    """false_positive action calls track_false_positive with correct args."""
    _auth_as(_AUDITOR_USER)
    sb = _make_review_sb()
    with patch("app.routers.reconciliation.get_supabase", return_value=sb), \
         patch("app.core.alert_engine.track_false_positive") as mock_track:
        client.post(
            f"/jobs/{JOB_ID}/reconciliation/{RESULT_ID}/review",
            json={"action": "false_positive"},
            headers=_AUTH,
        )
    mock_track.assert_called_once_with(TENANT_ID, JOB_ID, USER_ID)


# ── Dashboard ─────────────────────────────────────────────────────────────────

def _make_dashboard_sb(results: list):
    sb = MagicMock()
    sb.table.return_value.select.return_value \
        .eq.return_value.eq.return_value.is_.return_value \
        .order.return_value.execute.return_value = MagicMock(data=results)
    return sb


def test_dashboard_returns_unreviewed_discrepancies():
    _auth_as(_OWNER_USER)
    results = [
        {**_RESULT_DATA, "id": str(uuid.uuid4()), "estimated_leak_cents": 3000},
        {**_RESULT_DATA, "id": str(uuid.uuid4()), "estimated_leak_cents": 1500},
    ]
    sb = _make_dashboard_sb(results)
    with patch("app.routers.reconciliation.get_supabase", return_value=sb):
        resp = client.get("/reconciliation/dashboard", headers=_AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["unreviewed_count"] == 2
    assert body["total_unreviewed_leak_cents"] == 4500


def test_dashboard_empty_when_no_discrepancies():
    _auth_as(_OWNER_USER)
    sb = _make_dashboard_sb([])
    with patch("app.routers.reconciliation.get_supabase", return_value=sb):
        resp = client.get("/reconciliation/dashboard", headers=_AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["unreviewed_count"] == 0
    assert body["total_unreviewed_leak_cents"] == 0
    assert body["results"] == []


def test_dashboard_denied_for_tech():
    _auth_as(_TECH_USER)
    sb = _make_dashboard_sb([])
    with patch("app.routers.reconciliation.get_supabase", return_value=sb):
        resp = client.get("/reconciliation/dashboard", headers=_AUTH)
    assert resp.status_code == 403


def test_dashboard_accessible_to_auditor():
    _auth_as(_AUDITOR_USER)
    sb = _make_dashboard_sb([_RESULT_DATA])
    with patch("app.routers.reconciliation.get_supabase", return_value=sb):
        resp = client.get("/reconciliation/dashboard", headers=_AUTH)
    assert resp.status_code == 200
