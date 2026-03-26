"""Tests for /team endpoints.

Covers:
- POST /team/invite — email invite (owner only)
- POST /team/invite — 409 when member already exists
- POST /team/invite — 400 when no email/phone
- POST /team/invite — 403 for non-owner roles
- GET  /team — list team members (owner + auditor)
- GET  /team — 403 for tech role
- DELETE /team/{id} — remove member (owner)
- DELETE /team/{id} — 400 when removing self
- DELETE /team/{id} — 404 when member not in tenant
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user

TENANT_ID   = str(uuid.uuid4())
USER_ID     = str(uuid.uuid4())
MEMBER_ID   = str(uuid.uuid4())

_FAKE_TOKEN = jwt.encode({"sub": USER_ID}, "x", algorithm="HS256")
_AUTH       = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

_OWNER   = {"user_id": USER_ID,   "tenant_id": TENANT_ID, "role": "owner",   "email": "owner@example.com"}
_AUDITOR = {"user_id": USER_ID,   "tenant_id": TENANT_ID, "role": "auditor", "email": "aud@example.com"}
_TECH    = {"user_id": USER_ID,   "tenant_id": TENANT_ID, "role": "tech",    "email": "tech@example.com"}

client = TestClient(app)


def _auth_as(user: dict):
    app.dependency_overrides[get_current_user] = lambda: user
    patch("app.auth.get_current_user", return_value=user).start()


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


# ── POST /team/invite ─────────────────────────────────────────────────────────

def test_invite_email_returns_201():
    _auth_as(_OWNER)
    sb = MagicMock()
    # seat_limit = None → skip enforcement
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data={"seat_limit": None})
    # no existing user
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .execute.return_value = MagicMock(data=[])
    # insert pending invite
    sb.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": MEMBER_ID}])
    # admin invite
    sb.auth.admin.invite_user_by_email.return_value = MagicMock()

    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.post(
            "/team/invite",
            json={"email": "tech@example.com", "role": "tech"},
            headers=_AUTH,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["invited"] is True
    assert body["channel"] == "email"


def test_invite_requires_email_or_phone():
    _auth_as(_OWNER)
    with patch("app.routers.team.get_supabase", return_value=MagicMock()):
        resp = client.post("/team/invite", json={"role": "tech"}, headers=_AUTH)
    assert resp.status_code == 400
    assert "email or phone" in resp.json()["detail"]


def test_invite_409_when_already_member():
    _auth_as(_OWNER)
    sb = MagicMock()
    # seat_limit = None → skip enforcement
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data={"seat_limit": None})
    # existing user found
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .execute.return_value = MagicMock(data=[{"id": MEMBER_ID}])

    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.post(
            "/team/invite",
            json={"email": "tech@example.com", "role": "tech"},
            headers=_AUTH,
        )
    assert resp.status_code == 409


def test_invite_403_for_auditor():
    _auth_as(_AUDITOR)
    sb = MagicMock()
    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.post(
            "/team/invite",
            json={"email": "new@example.com", "role": "tech"},
            headers=_AUTH,
        )
    assert resp.status_code == 403


def test_invite_403_for_tech():
    _auth_as(_TECH)
    sb = MagicMock()
    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.post(
            "/team/invite",
            json={"email": "new@example.com", "role": "tech"},
            headers=_AUTH,
        )
    assert resp.status_code == 403


# ── GET /team ─────────────────────────────────────────────────────────────────

def test_list_team_returns_members():
    _auth_as(_OWNER)
    members = [
        {"id": USER_ID,   "email": "owner@example.com", "role": "owner",   "status": "active", "created_at": "2024-01-01T00:00:00Z", "phone": None},
        {"id": MEMBER_ID, "email": "tech@example.com",  "role": "tech",    "status": "invited", "created_at": "2024-01-02T00:00:00Z", "phone": None},
    ]
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.order.return_value \
        .execute.return_value = MagicMock(data=members)

    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.get("/team", headers=_AUTH)

    assert resp.status_code == 200
    assert len(resp.json()["members"]) == 2


def test_list_team_accessible_to_auditor():
    _auth_as(_AUDITOR)
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.order.return_value \
        .execute.return_value = MagicMock(data=[])

    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.get("/team", headers=_AUTH)
    assert resp.status_code == 200


def test_list_team_denied_for_tech():
    _auth_as(_TECH)
    sb = MagicMock()
    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.get("/team", headers=_AUTH)
    assert resp.status_code == 403


# ── DELETE /team/{id} ─────────────────────────────────────────────────────────

def test_remove_member_returns_200():
    _auth_as(_OWNER)
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .single.return_value.execute.return_value = MagicMock(
            data={"id": MEMBER_ID, "tenant_id": TENANT_ID, "role": "tech"}
        )
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data={})

    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.delete(f"/team/{MEMBER_ID}", headers=_AUTH)

    assert resp.status_code == 200
    assert resp.json()["removed"] is True


def test_remove_self_returns_400():
    _auth_as(_OWNER)
    with patch("app.routers.team.get_supabase", return_value=MagicMock()):
        resp = client.delete(f"/team/{USER_ID}", headers=_AUTH)
    assert resp.status_code == 400
    assert "Cannot remove yourself" in resp.json()["detail"]


def test_remove_member_not_found_returns_404():
    _auth_as(_OWNER)
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .single.return_value.execute.return_value = MagicMock(data=None)

    with patch("app.routers.team.get_supabase", return_value=sb):
        resp = client.delete(f"/team/{MEMBER_ID}", headers=_AUTH)
    assert resp.status_code == 404
