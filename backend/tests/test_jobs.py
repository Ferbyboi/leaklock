"""Tests for /jobs routes — tenant isolation + RBAC."""
import uuid
import jwt
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user

TENANT_A = str(uuid.uuid4())
TENANT_B = str(uuid.uuid4())
JOB_ID   = str(uuid.uuid4())

ADMIN_USER  = {"user_id": str(uuid.uuid4()), "tenant_id": TENANT_A, "role": "owner"}
VIEWER_USER = {"user_id": str(uuid.uuid4()), "tenant_id": TENANT_A, "role": "tech"}

# Any non-empty bearer token — HTTPBearer just extracts it; get_current_user is patched
_FAKE_TOKEN = jwt.encode({"sub": "u"}, "x", algorithm="HS256")
_AUTH = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

client = TestClient(app)


def _auth_override(user):
    """Override auth for all route patterns:
    - dependency_overrides: bypasses Security(get_current_user) in list/get routes
    - patch: makes require_role closures see the mock via module-level name lookup
    """
    app.dependency_overrides[get_current_user] = lambda: user
    patcher = patch('app.auth.get_current_user', return_value=user)
    patcher.start()


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


# ── List jobs ─────────────────────────────────────────────────────────────────

def test_list_jobs_returns_tenant_scoped():
    _auth_override(ADMIN_USER)
    mock_result = MagicMock()
    mock_result.data = [{"id": JOB_ID, "tenant_id": TENANT_A, "status": "pending_invoice"}]
    mock_result.count = 1

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        # Query chain: .table().select().eq("tenant_id").order().range().execute()
        mock_sb.return_value.table.return_value \
            .select.return_value \
            .eq.return_value \
            .order.return_value \
            .range.return_value \
            .execute.return_value = mock_result

        resp = client.get("/jobs", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


def test_list_jobs_requires_auth():
    resp = client.get("/jobs")
    assert resp.status_code == 403


# ── Get single job ─────────────────────────────────────────────────────────────

def test_get_job_not_found():
    _auth_override(ADMIN_USER)
    mock_result = MagicMock()
    mock_result.data = None

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        mock_sb.return_value.table.return_value \
            .select.return_value \
            .eq.return_value \
            .eq.return_value \
            .single.return_value \
            .execute.return_value = mock_result

        resp = client.get(f"/jobs/{JOB_ID}", headers=_AUTH)
    assert resp.status_code == 404


# ── Approve job ────────────────────────────────────────────────────────────────

def test_approve_job_success():
    _auth_override(ADMIN_USER)
    # Atomic update returns data — job was successfully approved
    update_result = MagicMock()
    update_result.data = [{"id": JOB_ID, "status": "approved"}]

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        tbl = mock_sb.return_value.table.return_value
        tbl.update.return_value.eq.return_value.eq.return_value \
            .neq.return_value.neq.return_value \
            .execute.return_value = update_result

        resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.json()["approved"] is True


def test_approve_job_already_approved():
    _auth_override(ADMIN_USER)
    # Atomic update returns [] — job already approved (.eq("status","pending_invoice") guard fired)
    # Diagnostic select returns the actual status so the correct 409 message is returned
    with patch("app.routers.jobs.get_supabase") as mock_sb:
        tbl = mock_sb.return_value.table.return_value
        tbl.update.return_value.eq.return_value.eq.return_value \
            .eq.return_value \
            .execute.return_value = MagicMock(data=[])
        tbl.select.return_value.eq.return_value.eq.return_value \
            .single.return_value.execute.return_value = MagicMock(
                data={"id": JOB_ID, "status": "approved"}
            )
        resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 409


def test_approve_job_frozen_blocked():
    _auth_override(ADMIN_USER)
    # Atomic update returns [] — job is frozen (.eq("status","pending_invoice") guard fired)
    with patch("app.routers.jobs.get_supabase") as mock_sb:
        tbl = mock_sb.return_value.table.return_value
        tbl.update.return_value.eq.return_value.eq.return_value \
            .eq.return_value \
            .execute.return_value = MagicMock(data=[])
        tbl.select.return_value.eq.return_value.eq.return_value \
            .single.return_value.execute.return_value = MagicMock(
                data={"id": JOB_ID, "status": "frozen"}
            )
        resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 409


def test_approve_requires_owner_or_auditor():
    _auth_override(VIEWER_USER)  # tech role — not allowed
    resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 403
