"""Tests for /jobs routes — tenant isolation + RBAC."""
import uuid
import jwt
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app

TENANT_A = str(uuid.uuid4())
TENANT_B = str(uuid.uuid4())
JOB_ID   = str(uuid.uuid4())

ADMIN_USER  = {"user_id": str(uuid.uuid4()), "tenant_id": TENANT_A, "role": "admin"}
VIEWER_USER = {"user_id": str(uuid.uuid4()), "tenant_id": TENANT_A, "role": "viewer"}

# Any non-empty bearer token — HTTPBearer just extracts it; get_current_user is patched
_FAKE_TOKEN = jwt.encode({"sub": "u"}, "x", algorithm="HS256")
_AUTH = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

client = TestClient(app)


def _auth_override(user):
    """Patch get_current_user at the module level so require_role closures see it."""
    patcher = patch('app.auth.get_current_user', return_value=user)
    patcher.start()


def teardown_function():
    patch.stopall()


# ── List jobs ─────────────────────────────────────────────────────────────────

def test_list_jobs_returns_tenant_scoped():
    _auth_override(ADMIN_USER)
    mock_result = MagicMock()
    mock_result.data = [{"id": JOB_ID, "tenant_id": TENANT_A, "status": "pending_invoice"}]

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        # Query chain: .table().select().eq("tenant_id").order().execute()
        mock_sb.return_value.table.return_value \
            .select.return_value \
            .eq.return_value \
            .order.return_value \
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
    fetch_result = MagicMock()
    fetch_result.data = {"id": JOB_ID, "status": "pending_invoice", "tenant_id": TENANT_A}
    update_result = MagicMock()
    update_result.data = [{"id": JOB_ID, "status": "approved"}]

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        tbl = mock_sb.return_value.table.return_value
        tbl.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = fetch_result
        tbl.update.return_value.eq.return_value.eq.return_value.execute.return_value = update_result

        resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.json()["approved"] is True


def test_approve_job_already_approved():
    _auth_override(ADMIN_USER)
    fetch_result = MagicMock()
    fetch_result.data = {"id": JOB_ID, "status": "approved", "tenant_id": TENANT_A}

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        tbl = mock_sb.return_value.table.return_value
        tbl.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = fetch_result

        resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 409


def test_approve_job_frozen_blocked():
    _auth_override(ADMIN_USER)
    fetch_result = MagicMock()
    fetch_result.data = {"id": JOB_ID, "status": "frozen", "tenant_id": TENANT_A}

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        tbl = mock_sb.return_value.table.return_value
        tbl.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = fetch_result

        resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 409


def test_approve_requires_admin_or_manager():
    _auth_override(VIEWER_USER)
    resp = client.post(f"/jobs/{JOB_ID}/approve", headers=_AUTH)
    assert resp.status_code == 403
