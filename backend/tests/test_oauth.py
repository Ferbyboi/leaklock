"""Tests for OAuth connect/callback/status/disconnect flows."""
import os
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user, get_supabase

AUTH_HEADERS = {"Authorization": "Bearer test-token"}

USER = {"sub": "user-1", "tenant_id": "tenant-1", "role": "owner"}


@pytest.fixture(autouse=True)
def _auth_override():
    app.dependency_overrides[get_current_user] = lambda: USER
    patch("app.auth.get_current_user", return_value=USER).start()
    yield
    app.dependency_overrides.clear()
    patch.stopall()


@pytest.fixture
def client():
    return TestClient(app)


def test_oauth_status_returns_providers(client):
    db = MagicMock()
    result = MagicMock()
    result.data = [
        {"provider": "square", "merchant_id": "merch-1", "expires_at": None, "updated_at": "2026-01-01"},
    ]
    chain = MagicMock()
    chain.execute.return_value = result
    chain.eq.return_value = chain
    db.table.return_value.select.return_value = chain

    with patch("app.connectors.oauth.get_supabase", return_value=db):
        resp = client.get("/oauth/status", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    data = resp.json()["integrations"]
    assert data["square"]["connected"] is True
    assert data["square"]["merchant_id"] == "merch-1"
    assert data["toast"]["connected"] is False


@patch.dict(os.environ, {
    "SQUARE_CLIENT_ID": "test-client-id",
    "SQUARE_CLIENT_SECRET": "test-secret",
})
def test_oauth_connect_returns_authorize_url(client):
    resp = client.get("/oauth/square/connect", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert "authorize_url" in resp.json()
    assert "connect.squareup.com" in resp.json()["authorize_url"]


def test_oauth_connect_unknown_provider(client):
    resp = client.get("/oauth/unknown_crm/connect", headers=AUTH_HEADERS)
    assert resp.status_code == 400


def test_oauth_connect_503_when_not_configured(client):
    for key in ["TOAST_CLIENT_ID", "TOAST_CLIENT_SECRET"]:
        os.environ.pop(key, None)
    resp = client.get("/oauth/toast/connect", headers=AUTH_HEADERS)
    assert resp.status_code == 503


def test_oauth_disconnect_success(client):
    db = MagicMock()
    chain = MagicMock()
    chain.execute.return_value = MagicMock(data=[])
    chain.eq.return_value = chain
    db.table.return_value.delete.return_value = chain

    with patch("app.connectors.oauth.get_supabase", return_value=db):
        resp = client.delete("/oauth/square/disconnect", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["success"] is True
