"""Tests for push subscription endpoints."""
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


def test_subscribe_push_success(client):
    db = MagicMock()
    upsert_result = MagicMock()
    upsert_result.data = [{"id": "sub-123"}]
    upsert_chain = MagicMock()
    upsert_chain.execute.return_value = upsert_result
    db.table.return_value.upsert.return_value = upsert_chain

    with patch("app.routers.push.get_supabase", return_value=db):
        resp = client.post("/push/subscribe", json={
            "endpoint": "https://fcm.googleapis.com/test",
            "p256dh": "test-key",
            "auth": "test-auth",
        }, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_unsubscribe_push_success(client):
    db = MagicMock()
    chain = MagicMock()
    chain.execute.return_value = MagicMock(data=[])
    chain.eq.return_value = chain
    db.table.return_value.delete.return_value = chain

    with patch("app.routers.push.get_supabase", return_value=db):
        resp = client.request("DELETE", "/push/unsubscribe", json={
            "endpoint": "https://fcm.googleapis.com/test",
            "p256dh": "test-key",
            "auth": "test-auth",
        }, headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@patch.dict(os.environ, {"VAPID_PUBLIC_KEY": "test-vapid-key"})
def test_vapid_key_returns_key(client):
    resp = client.get("/push/vapid-key")
    assert resp.status_code == 200
    assert resp.json()["vapid_public_key"] == "test-vapid-key"


def test_vapid_key_returns_503_when_not_set(client):
    old = os.environ.pop("VAPID_PUBLIC_KEY", None)
    try:
        resp = client.get("/push/vapid-key")
        assert resp.status_code == 503
    finally:
        if old:
            os.environ["VAPID_PUBLIC_KEY"] = old
