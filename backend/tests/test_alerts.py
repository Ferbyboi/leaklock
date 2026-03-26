"""Tests for /alerts endpoints.

Covers:
- GET /alerts — returns tenant-scoped unread alerts by default
- GET /alerts?unread_only=false — includes acknowledged alerts
- POST /alerts/{id}/acknowledge — marks alert as acknowledged
- POST /alerts/{id}/acknowledge — 404 when alert not in tenant
- POST /alerts/acknowledge-all — marks all unread alerts as read
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
USER_ID   = str(uuid.uuid4())
ALERT_ID  = str(uuid.uuid4())

_FAKE_TOKEN = jwt.encode({"sub": USER_ID}, "x", algorithm="HS256")
_AUTH       = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

_OWNER_USER = {
    "user_id":   USER_ID,
    "tenant_id": TENANT_ID,
    "role":      "owner",
    "email":     "owner@example.com",
}

_ALERT_UNREAD = {
    "id":              ALERT_ID,
    "title":           "Revenue Leak: Job JOB-001",
    "severity":        "critical",
    "job_id":          str(uuid.uuid4()),
    "created_at":      "2024-01-15T10:00:00Z",
    "acknowledged_at": None,
}

client = TestClient(app)


def _auth_as(user: dict):
    app.dependency_overrides[get_current_user] = lambda: user
    patch("app.auth.get_current_user", return_value=user).start()


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


# ── GET /alerts ────────────────────────────────────────────────────────────────

def test_list_alerts_returns_unread_by_default():
    _auth_as(_OWNER_USER)
    alerts = [_ALERT_UNREAD, {**_ALERT_UNREAD, "id": str(uuid.uuid4())}]

    sb = MagicMock()
    sb.table.return_value.select.return_value \
        .eq.return_value.order.return_value.range.return_value \
        .is_.return_value.execute.return_value = MagicMock(data=alerts, count=2)

    with patch("app.routers.alerts.get_supabase", return_value=sb):
        resp = client.get("/alerts", headers=_AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert body["unread_count"] == 2
    assert len(body["alerts"]) == 2


def test_list_alerts_all_when_unread_only_false():
    _auth_as(_OWNER_USER)
    alerts = [
        _ALERT_UNREAD,
        {**_ALERT_UNREAD, "id": str(uuid.uuid4()), "acknowledged_at": "2024-01-15T11:00:00Z"},
    ]

    sb = MagicMock()
    # unread_only=false skips the .is_() filter — chain is different
    sb.table.return_value.select.return_value \
        .eq.return_value.order.return_value.range.return_value \
        .execute.return_value = MagicMock(data=alerts, count=2)

    with patch("app.routers.alerts.get_supabase", return_value=sb):
        resp = client.get("/alerts?unread_only=false", headers=_AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert body["unread_count"] == 1  # only one is unread


def test_list_alerts_empty():
    _auth_as(_OWNER_USER)
    sb = MagicMock()
    sb.table.return_value.select.return_value \
        .eq.return_value.order.return_value.range.return_value \
        .is_.return_value.execute.return_value = MagicMock(data=[], count=0)

    with patch("app.routers.alerts.get_supabase", return_value=sb):
        resp = client.get("/alerts", headers=_AUTH)

    assert resp.status_code == 200
    assert resp.json()["total"] == 0


# ── POST /alerts/{id}/acknowledge ──────────────────────────────────────────────

def test_acknowledge_alert_returns_200():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    # lookup
    sb.table.return_value.select.return_value \
        .eq.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data=_ALERT_UNREAD)
    # update
    sb.table.return_value.update.return_value \
        .eq.return_value.eq.return_value.execute.return_value = MagicMock(data={})

    with patch("app.routers.alerts.get_supabase", return_value=sb):
        resp = client.post(f"/alerts/{ALERT_ID}/acknowledge", headers=_AUTH)

    assert resp.status_code == 200
    body = resp.json()
    assert body["acknowledged"] is True
    assert body["alert_id"] == ALERT_ID


def test_acknowledge_alert_404_when_not_found():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    sb.table.return_value.select.return_value \
        .eq.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data=None)

    with patch("app.routers.alerts.get_supabase", return_value=sb):
        resp = client.post(f"/alerts/{ALERT_ID}/acknowledge", headers=_AUTH)

    assert resp.status_code == 404


# ── POST /alerts/acknowledge-all ──────────────────────────────────────────────

def test_acknowledge_all_returns_200():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    sb.table.return_value.update.return_value \
        .eq.return_value.is_.return_value.execute.return_value = MagicMock(data={})

    with patch("app.routers.alerts.get_supabase", return_value=sb):
        resp = client.post("/alerts/acknowledge-all", headers=_AUTH)

    assert resp.status_code == 200
    assert resp.json()["acknowledged_all"] is True
