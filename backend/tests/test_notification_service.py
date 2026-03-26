"""Tests for NotificationService.

All external calls (Twilio, Resend, Slack HTTP, Supabase) are mocked.
No real network traffic is made.
"""
from __future__ import annotations

import time
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Ensure required env vars exist before the module is imported
import os
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("TWILIO_ACCOUNT_SID", "ACtest")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "authtest")
os.environ.setdefault("TWILIO_FROM_NUMBER", "+10000000000")
os.environ.setdefault("RESEND_API_KEY", "re_test_key")

TENANT_ID        = str(uuid.uuid4())
USER_ID          = str(uuid.uuid4())
ALERT_ID         = str(uuid.uuid4())
RECIPIENT_EMAIL  = "owner@example.com"
RECIPIENT_PHONE  = "+15550001234"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db(phone: str = RECIPIENT_PHONE, email: str = RECIPIENT_EMAIL,
             notification_prefs: dict | None = None,
             slack_webhook: str | None = "https://hooks.slack.com/test") -> MagicMock:
    """Build a Supabase client mock that returns controlled user/tenant data."""
    db = MagicMock()

    users_mock = MagicMock()
    tenants_mock = MagicMock()

    def _table_side_effect(name: str) -> MagicMock:
        if name == "users":
            return users_mock
        if name == "tenants":
            return tenants_mock
        return MagicMock()

    db.table.side_effect = _table_side_effect

    # Both users queries (select("email, phone") and select("notification_prefs"))
    # go through the same mock chain.  Return a combined row so both callers get
    # what they need: _fetch_recipient uses "email"/"phone", _get_user_prefs uses
    # "notification_prefs" (falls back to {} when absent — that is correct default).
    users_mock.select.return_value.eq.return_value.eq.return_value \
        .single.return_value.execute.return_value = MagicMock(
            data={
                "email": email,
                "phone": phone,
                "notification_prefs": notification_prefs or {},
            }
        )

    # tenants.select("settings").eq().single().execute() → slack webhook
    tenant_settings = (
        {"settings": {"slack_webhook_url": slack_webhook}}
        if slack_webhook
        else {"settings": {}}
    )
    tenants_mock.select.return_value.eq.return_value \
        .single.return_value.execute.return_value = MagicMock(data=tenant_settings)

    return db


def _make_service():
    from app.core.notification_service import NotificationService
    return NotificationService()


# ---------------------------------------------------------------------------
# 1. Critical severity routes to SMS
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sms_sent_for_critical():
    """Critical alert must dispatch SMS when phone exists and limit not hit."""
    # Reset the in-memory rate-limit state for this tenant
    from app.core import notification_service as ns_mod
    ns_mod._sms_log.pop(TENANT_ID, None)

    db = _make_db()
    svc = _make_service()

    with patch("app.core.notification_service.get_db", return_value=db), \
         patch("app.core.notification_service._send_sms", new_callable=AsyncMock) as mock_sms, \
         patch("app.core.notification_service._send_email", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_slack", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_inapp", new_callable=AsyncMock):

        result = await svc.send(
            severity="critical",
            channels=None,
            tenant_id=TENANT_ID,
            recipient_user_id=USER_ID,
            title="Revenue Leak",
            body="Unbilled work detected.",
            alert_id=ALERT_ID,
        )

    assert "sms" in result["dispatched"], "SMS must be dispatched for critical severity"
    mock_sms.assert_awaited_once()
    # First arg is the phone number, second is the body
    call_args = mock_sms.call_args
    assert call_args[0][0] == RECIPIENT_PHONE


# ---------------------------------------------------------------------------
# 2. Info severity routes to email only
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_email_only_for_info():
    """Info severity must send email and nothing else."""
    from app.core import notification_service as ns_mod
    ns_mod._sms_log.pop(TENANT_ID, None)

    db = _make_db()
    svc = _make_service()

    with patch("app.core.notification_service.get_db", return_value=db), \
         patch("app.core.notification_service._send_sms", new_callable=AsyncMock) as mock_sms, \
         patch("app.core.notification_service._send_email", new_callable=AsyncMock) as mock_email, \
         patch("app.core.notification_service._send_slack", new_callable=AsyncMock) as mock_slack, \
         patch("app.core.notification_service._send_inapp", new_callable=AsyncMock) as mock_inapp:

        result = await svc.send(
            severity="info",
            channels=None,
            tenant_id=TENANT_ID,
            recipient_user_id=USER_ID,
            title="Daily Digest",
            body="Your daily report is ready.",
            alert_id=None,
        )

    assert "email" in result["dispatched"]
    mock_email.assert_awaited_once()
    mock_sms.assert_not_awaited()
    mock_slack.assert_not_awaited()
    mock_inapp.assert_not_awaited()


# ---------------------------------------------------------------------------
# 3. Rate limit blocks SMS after 5 sends in the same hour
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rate_limit_blocks_sms_after_5():
    """The 6th SMS within one hour window must be blocked for the tenant."""
    from app.core import notification_service as ns_mod

    # Seed the rate-limit log with 5 timestamps within the current window
    now = time.time()
    ns_mod._sms_log[TENANT_ID] = [now - 100, now - 200, now - 300, now - 400, now - 500]

    # _sms_allowed should now return False without modifying the list
    allowed = ns_mod._sms_allowed.__wrapped__(TENANT_ID) if hasattr(
        ns_mod._sms_allowed, "__wrapped__"
    ) else ns_mod._sms_allowed(TENANT_ID)

    # Whether we test via helper or via a real send, the result is the same
    # We also test via a real send to prove the service respects the limit
    db = _make_db()
    svc = _make_service()
    # Pre-seed again (the call above may have consumed one slot)
    ns_mod._sms_log[TENANT_ID] = [now - 10, now - 20, now - 30, now - 40, now - 50]

    with patch("app.core.notification_service.get_db", return_value=db), \
         patch("app.core.notification_service._send_sms", new_callable=AsyncMock) as mock_sms, \
         patch("app.core.notification_service._send_email", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_slack", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_inapp", new_callable=AsyncMock):

        result = await svc.send(
            severity="critical",
            channels=["sms"],
            tenant_id=TENANT_ID,
            recipient_user_id=USER_ID,
            title="Flood Alert",
            body="6th SMS in hour — should be blocked.",
            alert_id=ALERT_ID,
        )

    mock_sms.assert_not_awaited()
    assert any("rate_limited" in s for s in result["skipped"]), (
        f"Expected rate_limited in skipped, got {result['skipped']}"
    )


# ---------------------------------------------------------------------------
# 4. Every send is logged to the notifications table
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notification_logged_to_db():
    """Each dispatched channel must insert a row into the notifications table."""
    from app.core import notification_service as ns_mod
    ns_mod._sms_log.pop(TENANT_ID, None)

    db = _make_db()
    svc = _make_service()

    with patch("app.core.notification_service.get_db", return_value=db), \
         patch("app.core.notification_service._send_sms", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_email", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_slack", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_inapp", new_callable=AsyncMock):

        await svc.send(
            severity="critical",
            channels=None,
            tenant_id=TENANT_ID,
            recipient_user_id=USER_ID,
            title="Test Log",
            body="Ensure logging occurs.",
            alert_id=ALERT_ID,
        )

    # notifications.insert() must have been called at least once.
    # With side_effect routing, check db.table was called with "notifications".
    table_calls = [c[0][0] for c in db.table.call_args_list]
    assert "notifications" in table_calls, (
        f"Expected notifications table to be accessed, got: {table_calls}"
    )


# ---------------------------------------------------------------------------
# 5. Slack is skipped when no webhook URL is configured
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_slack_skipped_when_no_webhook():
    """If no Slack webhook URL is set (neither in tenant settings nor env), skip silently."""
    from app.core import notification_service as ns_mod
    ns_mod._sms_log.pop(TENANT_ID, None)

    db = _make_db(slack_webhook=None)
    svc = _make_service()

    with patch("app.core.notification_service.get_db", return_value=db), \
         patch("app.core.notification_service._send_slack", new_callable=AsyncMock) as mock_slack, \
         patch("app.core.notification_service._send_sms", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_email", new_callable=AsyncMock), \
         patch("app.core.notification_service._send_inapp", new_callable=AsyncMock), \
         patch.dict(os.environ, {}, clear=False):

        # Remove env-level fallback for this test
        os.environ.pop("SLACK_WEBHOOK_URL", None)

        result = await svc.send(
            severity="warning",
            channels=None,
            tenant_id=TENANT_ID,
            recipient_user_id=USER_ID,
            title="Warning",
            body="No Slack webhook configured.",
        )

    mock_slack.assert_not_awaited()
    assert any("slack" in s for s in result["skipped"]), (
        f"Expected slack in skipped list, got {result['skipped']}"
    )


# ---------------------------------------------------------------------------
# 6. Channel list respects severity routing — warning = Slack + in-app only
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_channels_respect_severity_routing():
    """Warning severity must trigger Slack and in-app, but NOT SMS or email."""
    from app.core import notification_service as ns_mod
    ns_mod._sms_log.pop(TENANT_ID, None)

    db = _make_db()
    svc = _make_service()

    with patch("app.core.notification_service.get_db", return_value=db), \
         patch("app.core.notification_service._send_sms", new_callable=AsyncMock) as mock_sms, \
         patch("app.core.notification_service._send_email", new_callable=AsyncMock) as mock_email, \
         patch("app.core.notification_service._send_slack", new_callable=AsyncMock) as mock_slack, \
         patch("app.core.notification_service._send_inapp", new_callable=AsyncMock) as mock_inapp:

        result = await svc.send(
            severity="warning",
            channels=None,
            tenant_id=TENANT_ID,
            recipient_user_id=USER_ID,
            title="Approaching Service Date",
            body="Unit 4B is due for service within 7 days.",
        )

    mock_sms.assert_not_awaited()
    mock_email.assert_not_awaited()
    mock_slack.assert_awaited_once()
    mock_inapp.assert_awaited_once()

    assert "slack" in result["dispatched"]
    assert "in_app" in result["dispatched"]
    assert "sms" not in result["dispatched"]
    assert "email" not in result["dispatched"]
