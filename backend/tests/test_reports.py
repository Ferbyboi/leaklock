"""Tests for the PDF audit report endpoint.

Mocks auth and Supabase; verifies:
- 200 + application/pdf for a valid owner/auditor
- Content-Disposition header with CRM job ID
- PDF magic bytes present (non-empty output)
- 404 when Supabase returns no job data
- Job with zero reconciliation results still produces a valid PDF
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user, get_supabase

TENANT_ID = str(uuid.uuid4())
JOB_ID    = str(uuid.uuid4())
USER_ID   = str(uuid.uuid4())

_FAKE_TOKEN = jwt.encode({"sub": USER_ID}, "x", algorithm="HS256")
_AUTH       = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

_OWNER_USER = {
    "user_id":   USER_ID,
    "tenant_id": TENANT_ID,
    "role":      "owner",
    "email":     "owner@example.com",
}

_JOB_DATA = {
    "id":             JOB_ID,
    "crm_job_id":     "JOB-001",
    "tenant_id":      TENANT_ID,
    "client_name":    "Acme Plumbing Co.",
    "client_address": "123 Main St",
    "status":         "discrepancy",
    "created_at":     "2024-01-15T10:00:00Z",
    "field_notes": [
        {
            "raw_text":     "Replaced copper pipe under sink, installed new shutoff valve",
            "parsed_items": [{"item": "copper pipe", "qty": 2, "unit": "ft"}],
            "parse_status": "complete",
            "photo_urls":   [],
        }
    ],
    "field_events": [
        {
            "event_type":        "voice",
            "compliance_status": "pass",
            "parsed_data":       {},
            "created_at":        "2024-01-15T09:00:00Z",
        }
    ],
    "reconciliation_results": [
        {
            "status":               "discrepancy",
            "estimated_leak_cents": 4500,
            "missing_items": [
                {"item": "shutoff valve", "qty": 1, "estimated_leak_cents": 4500}
            ],
            "auditor_action": None,
            "reviewed_at":    None,
        }
    ],
}

_TENANT_DATA = {"name": "Acme Plumbing", "tenant_type": "plumbing"}

client = TestClient(app)


def _auth_as(user: dict):
    """Override auth for both Depends and Security(require_role(...)) paths."""
    app.dependency_overrides[get_current_user] = lambda: user
    patch("app.auth.get_current_user", return_value=user).start()


def _mock_supabase_for_reports(job_data, tenant_data=_TENANT_DATA):
    """Build a Supabase mock that routes job and tenant queries."""
    sb = MagicMock()

    # Job query: .table().select().eq(id).eq(tenant_id).single().execute()
    sb.table.return_value.select.return_value \
        .eq.return_value.eq.return_value \
        .single.return_value.execute.return_value = MagicMock(data=job_data)

    # Tenant query: .table().select().eq(id).single().execute()
    sb.table.return_value.select.return_value \
        .eq.return_value.single.return_value.execute.return_value = MagicMock(data=tenant_data)

    return sb


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


# ── Happy-path tests ───────────────────────────────────────────────────────────

def _run_report(job_data, user=_OWNER_USER):
    """Helper: set up auth + supabase mock, call the endpoint, return response."""
    _auth_as(user)
    sb = _mock_supabase_for_reports(job_data)
    with patch("app.routers.reports.get_supabase", return_value=sb):
        return client.get(f"/reports/job/{JOB_ID}/audit.pdf", headers=_AUTH)


def test_pdf_returns_200_with_content_type():
    resp = _run_report(_JOB_DATA)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"


def test_pdf_content_disposition_contains_crm_id():
    resp = _run_report(_JOB_DATA)
    cd = resp.headers.get("content-disposition", "")
    assert "JOB-001" in cd, f"Expected CRM ID in Content-Disposition, got: {cd}"
    assert "attachment" in cd


def test_pdf_body_starts_with_pdf_magic_bytes():
    resp = _run_report(_JOB_DATA)
    assert len(resp.content) > 1024, "PDF should be > 1 KB"
    assert resp.content[:4] == b"%PDF", "Response must start with PDF magic bytes"


def test_pdf_404_when_job_not_found():
    resp = _run_report(None)
    assert resp.status_code == 404


def test_pdf_works_with_no_reconciliation_results():
    """Job with empty recon/events arrays should still produce a valid PDF."""
    clean_job = {**_JOB_DATA, "reconciliation_results": [], "field_events": []}
    resp = _run_report(clean_job)
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"


def test_pdf_works_for_auditor_role():
    auditor = {**_OWNER_USER, "role": "auditor"}
    resp = _run_report(_JOB_DATA, user=auditor)
    assert resp.status_code == 200
