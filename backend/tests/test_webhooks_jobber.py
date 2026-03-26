"""Tests for the Jobber CRM webhook connector."""
import uuid
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user
from app.db import get_db
from app.routers.webhooks_jobber import normalize_jobber_payload, LineItem

TENANT = str(uuid.uuid4())
JOB_ID = str(uuid.uuid4())
TASK_ID = str(uuid.uuid4())
JOBBER_ACCOUNT = "acc_123"

client = TestClient(app)

_JOBBER_JOB_PAYLOAD = {
    "webHookEvent": "JOB_COMPLETED",
    "accountId": JOBBER_ACCOUNT,
    "data": {
        "job": {
            "id": "job_456",
            "status": "completed",
            "internalNotes": "Replaced copper pipe under sink",
            "attachments": [{"url": "https://cdn.jobber.com/photo1.jpg"}],
            "client": {
                "name": "John Smith",
                "billingAddress": {"street": "123 Main St"},
            },
            "lineItems": [
                {"name": "Copper pipe 3/4 inch", "quantity": 2, "unitPrice": 15.00},
            ],
        }
    },
}

_JOBBER_INVOICE_PAYLOAD = {
    "webHookEvent": "INVOICE_CREATED",
    "accountId": JOBBER_ACCOUNT,
    "data": {
        "job": {"id": "job_456", "status": "invoiced", "client": {"name": "John Smith"}},
        "invoice": {
            "lineItems": [
                {"name": "Copper pipe 3/4 inch", "quantity": 1, "unitPrice": 15.00},
            ]
        },
    },
}


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


# ── Normalizer unit tests ──────────────────────────────────────────────────────

def test_normalizer_job_completed():
    result = normalize_jobber_payload(
        "JOB_COMPLETED", _JOBBER_JOB_PAYLOAD["data"], TENANT
    )
    assert result is not None
    assert result.crm_job_id == "job_456"
    assert result.client_name == "John Smith"
    assert result.tech_notes == "Replaced copper pipe under sink"
    assert len(result.photo_urls) == 1
    assert result.job_status == "pending_invoice"


def test_normalizer_maps_estimate_line_items():
    result = normalize_jobber_payload(
        "JOB_COMPLETED", _JOBBER_JOB_PAYLOAD["data"], TENANT
    )
    assert len(result.estimate_items) == 1
    assert result.estimate_items[0].unit_price_cents == 1500
    assert result.estimate_items[0].qty == 2.0


def test_normalizer_invoice_line_items():
    result = normalize_jobber_payload(
        "INVOICE_CREATED", _JOBBER_INVOICE_PAYLOAD["data"], TENANT
    )
    assert len(result.invoice_items) == 1
    assert result.invoice_items[0].unit_price_cents == 1500


def test_normalizer_handles_missing_client_name():
    data = {"job": {"id": "j1", "client": {}, "status": "active"}}
    result = normalize_jobber_payload("JOB_UPDATE", data, TENANT)
    assert result.client_name == "Unknown"


def test_normalizer_status_mapping():
    for jobber_status, expected in [
        ("active", "in_progress"),
        ("completed", "pending_invoice"),
        ("archived", "complete"),
        ("unknown_status", "pending"),
    ]:
        data = {"job": {"id": "j1", "status": jobber_status, "client": {"name": "X"}}}
        result = normalize_jobber_payload("JOB_UPDATE", data, TENANT)
        assert result.job_status == expected, f"Failed for {jobber_status}"


# ── Webhook endpoint tests ─────────────────────────────────────────────────────

def test_webhook_job_completed_queues_parse():
    mock_task = MagicMock()
    mock_task.id = TASK_ID

    tenant_result = MagicMock()
    tenant_result.data = {"id": TENANT}

    job_result = MagicMock()
    job_result.data = [{"id": JOB_ID}]

    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = tenant_result
    sb.table.return_value.upsert.return_value.execute.return_value = job_result

    app.dependency_overrides[get_db] = lambda: sb

    with patch("app.workers.tasks.process_field_notes") as mock_pfn, \
         patch.dict("os.environ", {"JOBBER_WEBHOOK_SECRET": ""}):

        mock_pfn.delay.return_value = mock_task

        resp = client.post(
            "/webhooks/jobber",
            json=_JOBBER_JOB_PAYLOAD,
        )

    assert resp.status_code == 200
    assert resp.json()["action"] == "queued_parse"


def test_webhook_unknown_tenant_returns_200():
    tenant_result = MagicMock()
    tenant_result.data = None

    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = tenant_result

    app.dependency_overrides[get_db] = lambda: sb

    with patch.dict("os.environ", {"JOBBER_WEBHOOK_SECRET": ""}):
        resp = client.post("/webhooks/jobber", json={
            "webHookEvent": "JOB_COMPLETED",
            "accountId": "unknown_acc",
            "data": {}
        })

    assert resp.status_code == 200
    assert resp.json()["action"] == "ignored_unknown_tenant"
