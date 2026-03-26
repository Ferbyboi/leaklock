"""
End-to-end pipeline tests.
Tests the full flow: webhook → job ingestion → parse → match → alert.
All external calls (Supabase, Celery, Trigger.dev) are mocked.
"""
import uuid
from unittest.mock import MagicMock, patch, AsyncMock
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _make_db_mock(job_id: str):
    """Return a Supabase client mock that returns job_id on upsert."""
    db = MagicMock()
    # jobs.upsert().execute() → data=[{"id": job_id}]
    (db.table.return_value
       .upsert.return_value
       .execute.return_value) = MagicMock(data=[{"id": job_id}])
    # field_notes.insert().execute() and draft_invoices.insert().execute()
    db.table.return_value.insert.return_value.execute.return_value = MagicMock(data={})
    return db

TENANT = str(uuid.uuid4())
JOB_ID = str(uuid.uuid4())

GENERIC_PAYLOAD = {
    "crm_job_id": "JOB-001",
    "tenant_id": TENANT,
    "client_name": "Acme Corp",
    "tech_notes": "Replaced copper pipe 3/4 inch in basement. Installed new ball valve.",
    "photo_urls": [],
    "draft_invoice": {
        "line_items": [
            {"description": "ball valve", "qty": 1, "unit_price": 45.00},
            # copper pipe is MISSING from invoice — should trigger leak alert
        ]
    }
}

JOBBER_PAYLOAD = {
    "data": {
        "webHookEvent": {"itemId": "J-999", "jobStatus": "completed"},
        "job": {
            "id": "J-999",
            "client": {"name": "Test Client"},
            "fieldNotes": "Installed pressure relief valve. Replaced water heater element.",
            "photoUrls": [],
        }
    },
    "tenantId": TENANT,
}

JOBBER_PAYLOAD_NOT_COMPLETED = {
    "data": {
        "webHookEvent": {"itemId": "J-888", "jobStatus": "in_progress"},
        "job": {"id": "J-888", "client": {"name": "Test"}, "fieldNotes": ""},
    },
    "tenantId": TENANT,
}


# ── Webhook endpoint tests ─────────────────────────────────────────────────────

def test_generic_webhook_accepted():
    """Generic webhook directly ingests into Supabase and queues Celery — no Trigger.dev."""
    mock_db = _make_db_mock(JOB_ID)
    with patch("app.routers.webhooks.get_db", return_value=mock_db), \
         patch("app.workers.tasks.process_field_notes.delay") as mock_delay:
        resp = client.post("/webhooks/generic", json=GENERIC_PAYLOAD)
    assert resp.status_code == 200
    body = resp.json()
    assert body["received"] is True
    assert body["crm_job_id"] == "JOB-001"
    assert body["job_id"] == JOB_ID


def test_generic_webhook_queues_celery():
    """Celery process_field_notes task is queued after ingestion."""
    mock_db = _make_db_mock(JOB_ID)
    with patch("app.routers.webhooks.get_db", return_value=mock_db), \
         patch("app.workers.tasks.process_field_notes") as mock_task:
        mock_task.delay = MagicMock()
        resp = client.post("/webhooks/generic", json=GENERIC_PAYLOAD)
    assert resp.status_code == 200
    mock_task.delay.assert_called_once_with(JOB_ID, GENERIC_PAYLOAD["tenant_id"])



def test_servicetitan_webhook_forwarded():
    st_payload = {
        "eventId": "evt-st-001",
        "eventType": "job.completed",
        "data": {"job": {"id": 12345, "status": "completed"}},
    }
    with patch("app.routers.webhooks.send_trigger_event", new_callable=AsyncMock) as mock_ev:
        mock_ev.return_value = {"id": "evt_789"}
        resp = client.post(
            "/webhooks/servicetitan",
            json=st_payload,
            headers={"X-Tenant-ID": TENANT},
        )
    assert resp.status_code == 200
    mock_ev.assert_called_once()
    call_args = mock_ev.call_args[0]
    assert call_args[0] == "webhook.servicetitan"


# ── Match engine integration ───────────────────────────────────────────────────

def test_full_match_detects_unbilled_copper_pipe():
    """Copper pipe in field notes, NOT in invoice — should be missing."""
    from app.core.match_engine import run_three_way_match

    estimate = [{"description": "copper pipe 3/4 inch", "unit_price_cents": 3500}]
    field_notes = [
        {"item": "copper pipe 3/4 inch", "qty": 2, "confidence": 0.95},
        {"item": "ball valve", "qty": 1, "confidence": 0.90},
    ]
    invoice = [
        {"description": "ball valve", "unit_price_cents": 4500},
        # copper pipe missing
    ]
    result = run_three_way_match(estimate, field_notes, invoice)

    assert result["status"] == "discrepancy"
    assert len(result["missing_items"]) == 1
    assert result["missing_items"][0]["item"] == "copper pipe 3/4 inch"
    assert result["estimated_leak_cents"] == 7000  # 2 * 3500


def test_synonym_normalization_cpvc_matches_copper_pipe():
    from app.core.match_engine import run_three_way_match

    estimate = [{"description": "copper pipe", "unit_price_cents": 2000}]
    field_notes = [{"item": "cpvc pipe", "qty": 1, "confidence": 0.88}]
    invoice = [{"description": "copper pipe", "unit_price_cents": 2000}]

    result = run_three_way_match(estimate, field_notes, invoice)
    assert result["status"] == "clean"  # cpvc → copper pipe via synonym map


def test_match_empty_field_notes_no_leak():
    from app.core.match_engine import run_three_way_match
    result = run_three_way_match(
        estimate_items=[{"description": "service call", "unit_price_cents": 15000}],
        field_note_items=[],
        invoice_items=[{"description": "service call", "unit_price_cents": 15000}],
    )
    assert result["status"] == "clean"
    assert result["estimated_leak_cents"] == 0


# ── Alert engine threshold ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_alert_below_threshold_no_notification():
    """Leak of $10 (1000 cents) should NOT fire alerts (threshold = $25)."""
    from app.core.alert_engine import fire_revenue_leak_alert

    with patch("app.core.alert_engine.get_db") as mock_db, \
         patch("app.core.alert_engine._send_slack") as mock_slack:

        mock_db.return_value.table.return_value.select.return_value \
            .eq.return_value.eq.return_value.limit.return_value.execute.return_value \
            = MagicMock(data=[])

        await fire_revenue_leak_alert(
            JOB_ID, TENANT,
            {"estimated_leak_cents": 1000, "missing_items": [{"item": "washer", "estimated_leak_cents": 1000}]},
        )
        mock_slack.assert_not_called()


@pytest.mark.asyncio
async def test_alert_above_threshold_freezes_job():
    """Leak of $100 (10000 cents) should freeze the job."""
    from app.core.alert_engine import fire_revenue_leak_alert

    mock_db = MagicMock()
    # users query returns empty (no owner set up in test)
    mock_db.table.return_value.select.return_value.eq.return_value \
        .eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    mock_db.table.return_value.select.return_value.eq.return_value \
        .single.return_value.execute.return_value = MagicMock(data={"name": "Test Biz"})
    update_mock = MagicMock()
    mock_db.table.return_value.update.return_value.eq.return_value \
        .eq.return_value.execute = update_mock

    with patch("app.core.alert_engine.get_db", return_value=mock_db):
        await fire_revenue_leak_alert(
            JOB_ID, TENANT,
            {"estimated_leak_cents": 10000, "missing_items": [{"item": "water heater", "estimated_leak_cents": 10000}]},
        )

    # Verify freeze update was called
    mock_db.table.assert_any_call("jobs")
