"""Tests for POST /onboard — tenant creation and idempotency."""
import uuid
from unittest.mock import MagicMock, patch
import pytest
import jwt
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

USER_ID   = str(uuid.uuid4())
TENANT_ID = str(uuid.uuid4())


def _make_raw_token(payload: dict) -> str:
    """Produce a HS256 token — _decode_token will be patched to return the payload."""
    return jwt.encode(payload, "test-secret", algorithm="HS256")


# ── Happy path ────────────────────────────────────────────────────────────────

def test_onboard_creates_tenant():
    """New user (no tenant in token) → tenant row created, tenant_id returned."""
    payload = {"sub": USER_ID}  # no tenant_id yet
    token = _make_raw_token(payload)

    mock_supabase = MagicMock()
    mock_supabase.table.return_value.insert.return_value.execute.return_value.data = [
        {"id": TENANT_ID, "name": "Acme HVAC"}
    ]
    mock_supabase.auth.admin.update_user_by_id.return_value = MagicMock()

    with patch("app.routers.onboarding._decode_token", return_value=payload), \
         patch("app.routers.onboarding.get_supabase", return_value=mock_supabase):
        resp = client.post(
            "/onboard",
            json={"company_name": "Acme HVAC"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["tenant_id"] == TENANT_ID
    assert data["company_name"] == "Acme HVAC"

    # Admin update_user_by_id must be called with the correct user_id and metadata
    mock_supabase.auth.admin.update_user_by_id.assert_called_once_with(
        USER_ID,
        {"app_metadata": {"tenant_id": TENANT_ID, "user_role": "owner"}},
    )


def test_onboard_idempotent_when_tenant_already_exists():
    """Token already has tenant_id → return early without touching the DB."""
    existing_tenant_id = str(uuid.uuid4())
    payload = {
        "sub": USER_ID,
        "app_metadata": {"tenant_id": existing_tenant_id, "user_role": "owner"},
    }
    token = _make_raw_token(payload)

    mock_supabase = MagicMock()

    with patch("app.routers.onboarding._decode_token", return_value=payload), \
         patch("app.routers.onboarding.get_supabase", return_value=mock_supabase):
        resp = client.post(
            "/onboard",
            json={"company_name": "Acme HVAC"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["tenant_id"] == existing_tenant_id
    assert data["already_onboarded"] is True

    # No DB writes when already onboarded
    mock_supabase.table.assert_not_called()
    mock_supabase.auth.admin.update_user_by_id.assert_not_called()


# ── Auth failures ──────────────────────────────────────────────────────────────

def test_onboard_requires_auth():
    """No Authorization header → 403."""
    resp = client.post("/onboard", json={"company_name": "Acme"})
    assert resp.status_code == 403


def test_onboard_rejects_invalid_token():
    """Invalid JWT → 401."""
    with patch("app.routers.onboarding._decode_token", side_effect=jwt.InvalidTokenError("bad")):
        resp = client.post(
            "/onboard",
            json={"company_name": "Acme"},
            headers={"Authorization": "Bearer not-a-real-token"},
        )
    assert resp.status_code == 401


def test_onboard_rejects_token_without_sub():
    """Token with no 'sub' claim → 401."""
    payload = {}  # no sub
    token = _make_raw_token(payload)

    with patch("app.routers.onboarding._decode_token", return_value=payload):
        resp = client.post(
            "/onboard",
            json={"company_name": "Acme"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 401


# ── DB failure ─────────────────────────────────────────────────────────────────

def test_onboard_returns_500_when_db_fails():
    """Supabase insert returns no data → 500."""
    payload = {"sub": USER_ID}
    token = _make_raw_token(payload)

    mock_supabase = MagicMock()
    mock_supabase.table.return_value.insert.return_value.execute.return_value.data = None

    with patch("app.routers.onboarding._decode_token", return_value=payload), \
         patch("app.routers.onboarding.get_supabase", return_value=mock_supabase):
        resp = client.post(
            "/onboard",
            json={"company_name": "Acme"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 500
