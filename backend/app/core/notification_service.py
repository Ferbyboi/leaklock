"""Unified NotificationService — routes alerts to SMS, email, Slack, and in-app channels.

Routing rules (from design doc):
  critical → SMS + Slack + in-app + email
  warning  → Slack + in-app
  info     → email only

All sends are logged to the `notifications` table.
SMS is rate-limited to 5 per tenant per hour to prevent alert storms.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from collections import defaultdict
from typing import Any, Dict, List, Optional

import sentry_sdk

from app.db import get_db

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Severity → channel routing table
# ---------------------------------------------------------------------------
SEVERITY_CHANNELS: Dict[str, List[str]] = {
    "critical": ["sms", "slack", "in_app", "email"],
    "warning":  ["slack", "in_app"],
    "info":     ["email"],
}

# ---------------------------------------------------------------------------
# SMS rate-limit state  (max 5 SMS per tenant per rolling hour)
# ---------------------------------------------------------------------------
_SMS_MAX_PER_HOUR = 5
_SMS_WINDOW_SECONDS = 3600
_sms_log: Dict[str, List[float]] = defaultdict(list)


def _sms_allowed(tenant_id: str) -> bool:
    """Return True if the tenant has not yet hit the SMS rate limit."""
    now = time.time()
    cutoff = now - _SMS_WINDOW_SECONDS
    _sms_log[tenant_id] = [t for t in _sms_log[tenant_id] if t > cutoff]
    if len(_sms_log[tenant_id]) >= _SMS_MAX_PER_HOUR:
        return False
    _sms_log[tenant_id].append(now)
    return True


# ---------------------------------------------------------------------------
# Provider implementations (each < 50 lines, no hardcoded secrets)
# ---------------------------------------------------------------------------

async def _send_sms(to_phone: str, body: str) -> None:
    """Send SMS via Twilio. Reads credentials from env vars."""
    from twilio.rest import Client as TwilioClient  # lazy import

    account_sid = os.environ["TWILIO_ACCOUNT_SID"]
    auth_token  = os.environ["TWILIO_AUTH_TOKEN"]
    from_number = os.environ["TWILIO_FROM_NUMBER"]

    client = TwilioClient(account_sid, auth_token)
    await asyncio.to_thread(
        client.messages.create,
        body=body[:160],
        from_=from_number,
        to=to_phone,
    )


async def _send_email(to_email: str, subject: str, body: str) -> None:
    """Send transactional email via Resend."""
    import resend  # lazy import

    resend.api_key = os.environ["RESEND_API_KEY"]
    from_addr = os.getenv("RESEND_FROM_EMAIL", "alerts@leaklock.io")
    payload = {
        "from":    from_addr,
        "to":      to_email,
        "subject": subject,
        "text":    body,
    }
    await asyncio.to_thread(resend.Emails.send, payload)


async def _send_slack(webhook_url: str, title: str, body: str) -> None:
    """Post to a Slack incoming webhook."""
    import httpx  # already in requirements

    payload = {"text": f"*{title}*\n{body}"}
    async with httpx.AsyncClient(timeout=10) as http:
        response = await http.post(webhook_url, json=payload)
        response.raise_for_status()


async def _send_inapp(
    db: Any,
    tenant_id: str,
    recipient_user_id: str,
    alert_id: Optional[str],
    title: str,
    body: str,
    metadata: Dict[str, Any],
) -> None:
    """Insert a record into the `alerts` table for in-app delivery."""
    db.table("alerts").insert({
        "id":            str(uuid.uuid4()),
        "tenant_id":     tenant_id,
        "recipient_id":  recipient_user_id,
        "job_id":        metadata.get("job_id"),
        "title":         title,
        "body":          body,
        "metadata":      metadata,
        "read":          False,
        # severity and alert_type default to 'info' / 'in_app' via migration 015
    }).execute()


def _log_notification(
    db: Any,
    tenant_id: str,
    alert_id: Optional[str],
    channel: str,
    recipient: str,
    status: str,
) -> None:
    """Append a row to the `notifications` table (append-only, never updated)."""
    db.table("notifications").insert({
        "id":         str(uuid.uuid4()),
        "tenant_id":  tenant_id,
        "alert_id":   alert_id,
        "channel":    channel,
        "recipient":  recipient,
        "status":     status,
        "sent_at":    "now()",
    }).execute()


def _resolve_channels(severity: str, requested_channels: Optional[List[str]]) -> List[str]:
    """Return the effective channel list.

    If the caller supplies explicit channels, use them verbatim.
    Otherwise derive from the severity routing table.
    """
    if requested_channels:
        return list(requested_channels)
    return SEVERITY_CHANNELS.get(severity, ["in_app"])


def _get_user_prefs(db: Any, tenant_id: str, user_id: str) -> Dict[str, Any]:
    """Fetch notification_prefs JSONB from users table. Returns {} on miss."""
    try:
        res = (
            db.table("users")
            .select("notification_prefs")
            .eq("tenant_id", tenant_id)
            .eq("id", user_id)
            .single()
            .execute()
        )
        return (res.data or {}).get("notification_prefs") or {}
    except Exception:
        return {}


def _get_slack_webhook(db: Any, tenant_id: str) -> Optional[str]:
    """Look up per-tenant Slack webhook URL stored in tenant settings.

    Falls back to the SLACK_WEBHOOK_URL env var if the tenant row is absent.
    """
    try:
        res = (
            db.table("tenants")
            .select("settings")
            .eq("id", tenant_id)
            .single()
            .execute()
        )
        settings = (res.data or {}).get("settings") or {}
        url = settings.get("slack_webhook_url")
        if url:
            return url
    except Exception:
        pass
    return os.getenv("SLACK_WEBHOOK_URL")


# ---------------------------------------------------------------------------
# NotificationService
# ---------------------------------------------------------------------------

class NotificationService:
    """Route alerts to the correct providers and log every send."""

    async def send(
        self,
        severity: str,
        channels: Optional[List[str]],
        tenant_id: str,
        recipient_user_id: str,
        title: str,
        body: str,
        metadata: Optional[Dict[str, Any]] = None,
        alert_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Dispatch a notification across all applicable channels.

        Parameters
        ----------
        severity:            "critical" | "warning" | "info"
        channels:            Explicit list of channels; None = derive from severity.
        tenant_id:           Tenant scope — used for RLS-safe DB writes & rate-limit.
        recipient_user_id:   The user receiving the notification.
        title:               Short headline for the alert.
        body:                Full message body.
        metadata:            Arbitrary dict attached to the notification record.
        alert_id:            FK to the originating alert row (optional).

        Returns
        -------
        dict  with keys: dispatched (list), skipped (list), errors (list)
        """
        if metadata is None:
            metadata = {}

        effective_channels = _resolve_channels(severity, channels)
        db = get_db()

        # Respect per-user opt-out prefs
        prefs = _get_user_prefs(db, tenant_id, recipient_user_id)
        disabled = prefs.get("disabled_channels", [])
        effective_channels = [c for c in effective_channels if c not in disabled]

        # Fetch recipient contact details once
        recipient_row = self._fetch_recipient(db, tenant_id, recipient_user_id)
        phone   = recipient_row.get("phone", "")
        email   = recipient_row.get("email", "")

        dispatched: List[str] = []
        skipped: List[str]    = []
        errors: List[str]     = []

        for channel in effective_channels:
            status = "sent"
            try:
                if channel == "sms":
                    status = await self._dispatch_sms(
                        db, tenant_id, alert_id, phone, body,
                        dispatched, skipped,
                    )
                elif channel == "email":
                    await self._dispatch_email(db, tenant_id, alert_id, email, title, body, dispatched)
                elif channel == "slack":
                    await self._dispatch_slack(db, tenant_id, alert_id, title, body, dispatched, skipped)
                elif channel == "in_app":
                    await self._dispatch_inapp(
                        db, tenant_id, alert_id, recipient_user_id, title, body, metadata, dispatched,
                    )
                else:
                    skipped.append(channel)
                    continue

                if channel in dispatched:
                    _log_notification(db, tenant_id, alert_id, channel, email or recipient_user_id, status)

            except Exception as exc:
                errors.append(f"{channel}: {exc}")
                with sentry_sdk.new_scope() as scope:
                    scope.set_extra("job_id", alert_id)
                    scope.set_extra("tenant_id", tenant_id)
                    scope.capture_exception(exc)
                _log_notification(db, tenant_id, alert_id, channel, email or recipient_user_id, "error")

        return {"dispatched": dispatched, "skipped": skipped, "errors": errors}

    # ------------------------------------------------------------------
    # Private per-channel dispatch helpers (each < 50 lines)
    # ------------------------------------------------------------------

    def _fetch_recipient(self, db: Any, tenant_id: str, user_id: str) -> Dict[str, Any]:
        try:
            res = (
                db.table("users")
                .select("email, phone")
                .eq("tenant_id", tenant_id)
                .eq("id", user_id)
                .single()
                .execute()
            )
            return res.data or {}
        except Exception:
            return {}

    async def _dispatch_sms(
        self,
        db: Any,
        tenant_id: str,
        alert_id: Optional[str],
        phone: str,
        body: str,
        dispatched: List[str],
        skipped: List[str],
    ) -> str:
        if not phone:
            skipped.append("sms:no_phone")
            return "skipped"
        if not _sms_allowed(tenant_id):
            skipped.append("sms:rate_limited")
            _log_notification(db, tenant_id, alert_id, "sms", phone, "rate_limited")
            return "rate_limited"
        if not os.getenv("TWILIO_ACCOUNT_SID"):
            skipped.append("sms:no_credentials")
            return "skipped"
        await _send_sms(phone, body)
        dispatched.append("sms")
        return "sent"

    async def _dispatch_email(
        self,
        db: Any,
        tenant_id: str,
        alert_id: Optional[str],
        email: str,
        title: str,
        body: str,
        dispatched: List[str],
    ) -> None:
        if not email:
            return
        if not os.getenv("RESEND_API_KEY"):
            return
        await _send_email(email, title, body)
        dispatched.append("email")

    async def _dispatch_slack(
        self,
        db: Any,
        tenant_id: str,
        alert_id: Optional[str],
        title: str,
        body: str,
        dispatched: List[str],
        skipped: List[str],
    ) -> None:
        webhook_url = _get_slack_webhook(db, tenant_id)
        if not webhook_url:
            skipped.append("slack:no_webhook")
            return
        await _send_slack(webhook_url, title, body)
        dispatched.append("slack")

    async def _dispatch_inapp(
        self,
        db: Any,
        tenant_id: str,
        alert_id: Optional[str],
        recipient_user_id: str,
        title: str,
        body: str,
        metadata: Dict[str, Any],
        dispatched: List[str],
    ) -> None:
        await _send_inapp(db, tenant_id, recipient_user_id, alert_id, title, body, metadata)
        dispatched.append("in_app")
