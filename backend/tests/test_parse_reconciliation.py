"""Tests for /jobs/{id}/parse and /jobs/{id}/reconciliation routes."""
import uuid
import jwt
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user

TENANT = str(uuid.uuid4())
JOB_ID = str(uuid.uuid4())
TASK_ID = str(uuid.uuid4())

ADMIN = {"user_id": str(uuid.uuid4()), "tenant_id": TENANT, "role": "admin"}
VIEWER = {"user_id": str(uuid.uuid4()), "tenant_id": TENANT, "role": "viewer"}

_FAKE_TOKEN = jwt.encode({"sub": "u"}, "x", algorithm="HS256")
_AUTH = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

client = TestClient(app)


def _auth(user):
    app.dependency_overrides[get_current_user] = lambda: user
    patcher = patch('app.auth.get_current_user', return_value=user)
    patcher.start()


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


# ── /parse ────────────────────────────────────────────────────────────────────

def test_trigger_parse_queues_celery():
    _auth(ADMIN)
    fetch_result = MagicMock()
    fetch_result.data = {"id": JOB_ID, "tenant_id": TENANT}

    mock_task = MagicMock()
    mock_task.id = TASK_ID

    with patch("app.routers.jobs.get_supabase") as mock_sb, \
         patch("app.workers.tasks.process_field_notes") as mock_pfn:
        mock_sb.return_value.table.return_value \
            .select.return_value.eq.return_value.eq.return_value \
            .single.return_value.execute.return_value = fetch_result
        mock_pfn.delay.return_value = mock_task

        resp = client.post(f"/jobs/{JOB_ID}/parse", headers=_AUTH)

    assert resp.status_code == 200
    assert resp.json()["queued"] is True
    assert resp.json()["task_id"] == TASK_ID


def test_trigger_parse_requires_admin():
    _auth(VIEWER)
    resp = client.post(f"/jobs/{JOB_ID}/parse", headers=_AUTH)
    assert resp.status_code == 403


def test_trigger_parse_job_not_found():
    _auth(ADMIN)
    fetch_result = MagicMock()
    fetch_result.data = None

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        mock_sb.return_value.table.return_value \
            .select.return_value.eq.return_value.eq.return_value \
            .single.return_value.execute.return_value = fetch_result

        resp = client.post(f"/jobs/{JOB_ID}/parse", headers=_AUTH)
    assert resp.status_code == 404


# ── /reconciliation ───────────────────────────────────────────────────────────

def test_get_reconciliation_success():
    _auth(ADMIN)
    mock_result = MagicMock()
    mock_result.data = [{
        "id": str(uuid.uuid4()),
        "job_id": JOB_ID,
        "tenant_id": TENANT,
        "status": "discrepancy",
        "missing_items": [{"item": "copper pipe", "qty": 2, "estimated_leak_cents": 4000}],
        "extra_items": [],
        "estimated_leak_cents": 4000,
    }]

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        mock_sb.return_value.table.return_value \
            .select.return_value.eq.return_value.eq.return_value \
            .order.return_value.limit.return_value.execute.return_value = mock_result

        resp = client.get(f"/jobs/{JOB_ID}/reconciliation")

    assert resp.status_code == 200
    assert resp.json()["status"] == "discrepancy"
    assert resp.json()["estimated_leak_cents"] == 4000


def test_get_reconciliation_not_found():
    _auth(ADMIN)
    mock_result = MagicMock()
    mock_result.data = []

    with patch("app.routers.jobs.get_supabase") as mock_sb:
        mock_sb.return_value.table.return_value \
            .select.return_value.eq.return_value.eq.return_value \
            .order.return_value.limit.return_value.execute.return_value = mock_result

        resp = client.get(f"/jobs/{JOB_ID}/reconciliation")
    assert resp.status_code == 404


# ── Match engine unit tests ───────────────────────────────────────────────────

def test_match_engine_clean():
    from app.core.match_engine import run_three_way_match
    result = run_three_way_match(
        estimate_items=[{"description": "copper pipe 3/4 inch", "unit_price_cents": 2000}],
        field_note_items=[{"item": "copper pipe", "qty": 1, "confidence": 0.95}],
        invoice_items=[{"description": "copper pipe 3/4 inch", "unit_price_cents": 2000}],
    )
    assert result["status"] == "clean"
    assert result["estimated_leak_cents"] == 0


def test_match_engine_detects_leak():
    from app.core.match_engine import run_three_way_match
    result = run_three_way_match(
        estimate_items=[{"description": "copper pipe", "unit_price_cents": 2000}],
        field_note_items=[{"item": "copper pipe", "qty": 2, "confidence": 0.9}],
        invoice_items=[],  # nothing billed
    )
    assert result["status"] == "discrepancy"
    assert len(result["missing_items"]) == 1


def test_match_engine_skips_low_confidence():
    from app.core.match_engine import run_three_way_match
    result = run_three_way_match(
        estimate_items=[],
        field_note_items=[{"item": "maybe something", "qty": 1, "confidence": 0.3}],
        invoice_items=[],
    )
    assert result["status"] == "clean"
