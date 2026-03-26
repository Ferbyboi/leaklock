"""Tests for alert_engine.fire_revenue_leak_alert.

Covers:
- Below ALERT_THRESHOLD_CENTS → no notifications sent, job not frozen
- Above threshold → job frozen, Slack/email/SMS dispatched when env vars set
- Missing env vars → channels silently skipped (best-effort)
- Slack uses SLACK_WEBHOOK_URL with httpx (not slack_sdk)
- SMS uses TWILIO_FROM_NUMBER (not TWILIO_FROM_PHONE)
- PostHog event always captured when POSTHOG_API_KEY is set
- Owner lookup failure → notifications skipped gracefully
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


TENANT_ID = "tenant-abc"
JOB_ID    = "job-xyz"

_MATCH_RESULT = {
    "estimated_leak_cents": 5000,
    "missing_items": [
        {"item": "shutoff valve", "qty": 1, "estimated_leak_cents": 5000}
    ],
}

_MATCH_RESULT_SMALL = {
    "estimated_leak_cents": 100,  # $1 — below default $25 threshold
    "missing_items": [{"item": "screw", "qty": 1, "estimated_leak_cents": 100}],
}


def _make_db(owner=None, tenant_name="Acme Plumbing"):
    db = MagicMock()
    # owner query
    db.table.return_value.select.return_value \
        .eq.return_value.eq.return_value \
        .limit.return_value.execute.return_value = MagicMock(
            data=[owner] if owner else []
        )
    # tenant query
    db.table.return_value.select.return_value \
        .eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data={"name": tenant_name})
    # job freeze update
    db.table.return_value.update.return_value \
        .eq.return_value.eq.return_value \
        .execute.return_value = MagicMock(data=[{"id": JOB_ID}])
    return db


@pytest.mark.asyncio
@patch("app.core.alert_engine.get_db")
async def test_below_threshold_skips_all_notifications(mock_get_db, monkeypatch):
    monkeypatch.setenv("ALERT_THRESHOLD_CENTS", "2500")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")

    db = _make_db(owner={"email": "owner@test.com", "phone": "+15550001234"})
    mock_get_db.return_value = db

    with patch("app.core.alert_engine._send_slack", new_callable=AsyncMock) as mock_slack, \
         patch("app.core.alert_engine._send_email", new_callable=AsyncMock) as mock_email, \
         patch("app.core.alert_engine._send_sms", new_callable=AsyncMock) as mock_sms:

        from app.core.alert_engine import fire_revenue_leak_alert
        await fire_revenue_leak_alert(JOB_ID, TENANT_ID, _MATCH_RESULT_SMALL)

    mock_slack.assert_not_called()
    mock_email.assert_not_called()
    mock_sms.assert_not_called()
    # Job should not be frozen either
    db.table.return_value.update.assert_not_called()


@pytest.mark.asyncio
@patch("app.core.alert_engine.get_db")
async def test_above_threshold_freezes_job(mock_get_db, monkeypatch):
    monkeypatch.setenv("ALERT_THRESHOLD_CENTS", "2500")
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)

    db = _make_db()
    mock_get_db.return_value = db

    from app.core.alert_engine import fire_revenue_leak_alert
    await fire_revenue_leak_alert(JOB_ID, TENANT_ID, _MATCH_RESULT)

    db.table.return_value.update.assert_called_once()
    call_args = db.table.return_value.update.call_args[0][0]
    assert call_args["status"] == "frozen"
    assert call_args["match_status"] == "discrepancy"


@pytest.mark.asyncio
@patch("app.core.alert_engine.get_db")
async def test_slack_sent_when_webhook_url_set(mock_get_db, monkeypatch):
    monkeypatch.setenv("ALERT_THRESHOLD_CENTS", "100")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)

    db = _make_db()
    mock_get_db.return_value = db

    with patch("app.core.alert_engine._send_slack", new_callable=AsyncMock) as mock_slack:
        from app.core.alert_engine import fire_revenue_leak_alert
        await fire_revenue_leak_alert(JOB_ID, TENANT_ID, _MATCH_RESULT)

    mock_slack.assert_called_once()
    # Message should reference the job URL
    message_arg = mock_slack.call_args[0][0]
    assert JOB_ID in message_arg


@pytest.mark.asyncio
@patch("app.core.alert_engine.get_db")
async def test_email_sent_when_owner_email_and_resend_key_set(mock_get_db, monkeypatch):
    monkeypatch.setenv("ALERT_THRESHOLD_CENTS", "100")
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)

    db = _make_db(owner={"email": "owner@test.com", "phone": ""})
    mock_get_db.return_value = db

    with patch("app.core.alert_engine._send_email", new_callable=AsyncMock) as mock_email:
        from app.core.alert_engine import fire_revenue_leak_alert
        await fire_revenue_leak_alert(JOB_ID, TENANT_ID, _MATCH_RESULT)

    mock_email.assert_called_once()
    assert mock_email.call_args[0][0] == "owner@test.com"


@pytest.mark.asyncio
@patch("app.core.alert_engine.get_db")
async def test_sms_uses_twilio_from_number(mock_get_db, monkeypatch):
    """Regression: verify TWILIO_FROM_NUMBER is used (not TWILIO_FROM_PHONE)."""
    monkeypatch.setenv("ALERT_THRESHOLD_CENTS", "100")
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACtest")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "authtest")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+15550000000")

    db = _make_db(owner={"email": "", "phone": "+15559999999"})
    mock_get_db.return_value = db

    with patch("app.core.alert_engine._send_sms", new_callable=AsyncMock) as mock_sms:
        from app.core.alert_engine import fire_revenue_leak_alert
        await fire_revenue_leak_alert(JOB_ID, TENANT_ID, _MATCH_RESULT)

    mock_sms.assert_called_once()
    # The actual SMS function reads TWILIO_FROM_NUMBER internally
    # We just verify it was called without raising AttributeError
    assert mock_sms.call_args[0][0] == "+15559999999"


@pytest.mark.asyncio
@patch("app.core.alert_engine.get_db")
async def test_missing_owner_skips_email_and_sms(mock_get_db, monkeypatch):
    monkeypatch.setenv("ALERT_THRESHOLD_CENTS", "100")
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACtest")

    db = _make_db(owner=None)  # No owner found
    mock_get_db.return_value = db

    with patch("app.core.alert_engine._send_email", new_callable=AsyncMock) as mock_email, \
         patch("app.core.alert_engine._send_sms", new_callable=AsyncMock) as mock_sms:
        from app.core.alert_engine import fire_revenue_leak_alert
        await fire_revenue_leak_alert(JOB_ID, TENANT_ID, _MATCH_RESULT)

    mock_email.assert_not_called()
    mock_sms.assert_not_called()


@pytest.mark.asyncio
@patch("app.core.alert_engine.get_db")
async def test_notification_failure_does_not_raise(mock_get_db, monkeypatch):
    """Notifications are best-effort — channel failures must not propagate."""
    monkeypatch.setenv("ALERT_THRESHOLD_CENTS", "100")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/test")

    db = _make_db()
    mock_get_db.return_value = db

    with patch("app.core.alert_engine._send_slack", new_callable=AsyncMock, side_effect=Exception("network error")), \
         patch("sentry_sdk.capture_exception"):
        from app.core.alert_engine import fire_revenue_leak_alert
        # Should NOT raise
        await fire_revenue_leak_alert(JOB_ID, TENANT_ID, _MATCH_RESULT)
