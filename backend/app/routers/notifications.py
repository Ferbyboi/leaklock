"""Notifications router — HTTP endpoints for email, SMS, and Slack delivery.

Called by the `send-notification` Supabase Edge Function.

Endpoints
---------
POST /notifications/email   — send email for a detected revenue leak
POST /notifications/sms     — send SMS via Twilio REST API
POST /notifications/slack   — post to a Slack incoming webhook
GET  /notifications/logs    — query notification_logs for the tenant

All sends are logged to `notification_logs` (append-only).
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
import uuid
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

import asyncio

import httpx
import sentry_sdk
from fastapi import APIRouter, HTTPException, Query, Security, status
from pydantic import BaseModel, EmailStr

from app.auth import get_current_user, get_supabase
from app.core.rate_limiter import check_rate_limit, RateLimitExceeded

logger = logging.getLogger(__name__)
router = APIRouter()


async def _with_retry(coro_fn, max_attempts: int = 3, base_delay: float = 1.0):
    """Retry an async callable with exponential backoff on transient errors."""
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return await coro_fn()
        except httpx.HTTPStatusError as exc:
            # Don't retry 4xx client errors
            if exc.response.status_code < 500:
                raise
            last_exc = exc
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            last_exc = exc
        if attempt < max_attempts - 1:
            delay = base_delay * (2 ** attempt)
            logger.warning("Attempt %d failed, retrying in %.1fs: %s", attempt + 1, delay, last_exc)
            await asyncio.sleep(delay)
    raise last_exc


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class EmailRequest(BaseModel):
    job_id: str
    tenant_id: str
    notification_type: str
    subject: str
    body_html: str
    body_text: str
    recipient_email: Optional[str] = None


class EmailResponse(BaseModel):
    success: bool
    message_id: Optional[str] = None


class SMSRequest(BaseModel):
    job_id: str
    tenant_id: str
    to_phone: str
    message: str


class SMSResponse(BaseModel):
    success: bool
    sid: Optional[str] = None


class SlackRequest(BaseModel):
    job_id: str
    tenant_id: str
    message: str
    blocks: Optional[List[Dict[str, Any]]] = None


class SlackResponse(BaseModel):
    success: bool


# ---------------------------------------------------------------------------
# notification_logs helpers
# ---------------------------------------------------------------------------

def _log_notification(
    supabase: Any,
    tenant_id: str,
    job_id: str,
    channel: str,
    status: str,
    error_msg: Optional[str] = None,
) -> None:
    """Append a row to notification_logs — never updated, only inserted."""
    row: Dict[str, Any] = {
        "id":        str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "job_id":    job_id,
        "channel":   channel,
        "status":    status,
        "sent_at":   datetime.now(timezone.utc).isoformat(),
    }
    if error_msg:
        row["error_msg"] = error_msg[:500]  # guard against oversized messages
    try:
        supabase.table("notification_logs").insert(row).execute()
    except Exception as log_exc:
        # Never let logging failure mask the real error
        logger.error("Failed to write notification_logs row: %s", log_exc)
        sentry_sdk.capture_exception(log_exc)


def _check_duplicate(
    supabase: Any,
    tenant_id: str,
    job_id: str,
    channel: str,
    notification_type: str,
    window_hours: int = 24,
) -> bool:
    """Return True if a successful notification was already sent within window_hours."""
    from datetime import datetime, timezone, timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).isoformat()
    try:
        res = (
            supabase.table("notification_logs")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("job_id", job_id)
            .eq("channel", channel)
            .eq("status", "sent")
            .gte("sent_at", cutoff)
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception as exc:
        logger.warning("Dedup check failed, proceeding with send: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Email helpers — SendGrid preferred, SMTP fallback
# ---------------------------------------------------------------------------

async def _send_email_sendgrid(
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str,
    api_key: str,
) -> str:
    """Send via SendGrid v3 mail/send. Returns message_id from X-Message-Id header."""
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": os.getenv("SENDGRID_FROM_EMAIL", "alerts@leaklock.io")},
        "subject": subject,
        "content": [
            {"type": "text/plain", "value": body_text},
            {"type": "text/html",  "value": body_html},
        ],
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await _with_retry(
            lambda: client.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                },
                json=payload,
            )
        )
    resp.raise_for_status()
    return resp.headers.get("X-Message-Id", "")


def _send_email_smtp(
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str,
) -> str:
    """Send via SMTP using env vars SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS."""
    smtp_host = os.environ["SMTP_HOST"]
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.environ["SMTP_USER"]
    smtp_pass = os.environ["SMTP_PASS"]
    from_addr = os.getenv("SMTP_FROM_EMAIL", smtp_user)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_addr
    msg["To"]      = to_email
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    context = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.ehlo()
        server.starttls(context=context)
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_addr, [to_email], msg.as_string())

    # SMTP has no native message ID in the response — build a deterministic one
    return f"smtp-{uuid.uuid4()}"


async def _resolve_owner_email(supabase: Any, tenant_id: str) -> Optional[str]:
    """Fetch the owner's email for the tenant from the users table."""
    try:
        res = (
            supabase.table("users")
            .select("email")
            .eq("tenant_id", tenant_id)
            .eq("role", "owner")
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows:
            return rows[0].get("email")
    except Exception as exc:
        logger.warning("Could not resolve owner email for tenant %s: %s", tenant_id, exc)
    return None


# ---------------------------------------------------------------------------
# POST /notifications/email
# ---------------------------------------------------------------------------

@router.post("/notifications/email", response_model=EmailResponse)
async def send_email(
    body: EmailRequest,
    user: dict = Security(get_current_user),
):
    """Send an email notification for a detected revenue leak.

    Prefers SendGrid (SENDGRID_API_KEY) and falls back to SMTP.
    If recipient_email is omitted, the tenant owner's email is used.
    Every attempt — success or failure — is logged to notification_logs.
    """
    supabase = get_supabase()

    with sentry_sdk.new_scope() as scope:
        scope.set_tag("job_id",    body.job_id)
        scope.set_tag("tenant_id", body.tenant_id)
        scope.set_tag("channel",   "email")

        # Tenant-scope guard: callers may only send for their own tenant
        if body.tenant_id != user["tenant_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_id in body does not match authenticated tenant",
            )

        try:
            check_rate_limit(body.tenant_id, "email")
        except RateLimitExceeded as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"error": str(exc), "retry_after": exc.retry_after},
                headers={"Retry-After": str(exc.retry_after)},
            )

        if _check_duplicate(supabase, body.tenant_id, body.job_id, "email", body.notification_type):
            _log_notification(
                supabase, body.tenant_id, body.job_id, "email", "skipped", "deduplicated",
            )
            return EmailResponse(success=True, message_id="deduplicated")

        recipient = body.recipient_email
        if not recipient:
            recipient = await _resolve_owner_email(supabase, body.tenant_id)
        if not recipient:
            _log_notification(
                supabase, body.tenant_id, body.job_id, "email", "failed",
                "No recipient email found and no owner email on record",
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No recipient_email provided and no owner email found for tenant",
            )

        message_id: Optional[str] = None

        try:
            sendgrid_key = os.getenv("SENDGRID_API_KEY")
            if sendgrid_key:
                message_id = await _send_email_sendgrid(
                    recipient, body.subject, body.body_html, body.body_text, sendgrid_key,
                )
            else:
                # SMTP fallback — synchronous but acceptable; emails are low-volume
                message_id = await asyncio.to_thread(
                    _send_email_smtp,
                    recipient, body.subject, body.body_html, body.body_text,
                )

            _log_notification(supabase, body.tenant_id, body.job_id, "email", "sent")
            return EmailResponse(success=True, message_id=message_id)

        except Exception as exc:
            error_msg = str(exc)
            sentry_sdk.capture_exception(exc)
            _log_notification(
                supabase, body.tenant_id, body.job_id, "email", "failed", error_msg,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Email delivery failed: {error_msg}",
            )


# ---------------------------------------------------------------------------
# POST /notifications/sms
# ---------------------------------------------------------------------------

@router.post("/notifications/sms", response_model=SMSResponse)
async def send_sms(
    body: SMSRequest,
    user: dict = Security(get_current_user),
):
    """Send an SMS via the Twilio REST API (Basic auth, no SDK).

    Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.
    """
    supabase = get_supabase()

    with sentry_sdk.new_scope() as scope:
        scope.set_tag("job_id",    body.job_id)
        scope.set_tag("tenant_id", body.tenant_id)
        scope.set_tag("channel",   "sms")

        if body.tenant_id != user["tenant_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_id in body does not match authenticated tenant",
            )

        try:
            check_rate_limit(body.tenant_id, "sms")
        except RateLimitExceeded as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"error": str(exc), "retry_after": exc.retry_after},
                headers={"Retry-After": str(exc.retry_after)},
            )

        if _check_duplicate(supabase, body.tenant_id, body.job_id, "sms", "alert"):
            _log_notification(
                supabase, body.tenant_id, body.job_id, "sms", "skipped", "deduplicated",
            )
            return SMSResponse(success=True, sid="deduplicated")

        account_sid  = os.getenv("TWILIO_ACCOUNT_SID")
        auth_token   = os.getenv("TWILIO_AUTH_TOKEN")
        from_number  = os.getenv("TWILIO_FROM_NUMBER")

        if not all([account_sid, auth_token, from_number]):
            _log_notification(
                supabase, body.tenant_id, body.job_id, "sms", "skipped",
                "Twilio credentials not configured",
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="SMS not configured — missing Twilio environment variables",
            )

        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await _with_retry(
                    lambda: client.post(
                        url,
                        auth=(account_sid, auth_token),  # type: ignore[arg-type]
                        data={
                            "From": from_number,
                            "To":   body.to_phone,
                            "Body": body.message[:1600],  # Twilio hard limit
                        },
                    )
                )
            resp.raise_for_status()
            sid = resp.json().get("sid", "")

            _log_notification(supabase, body.tenant_id, body.job_id, "sms", "sent")
            return SMSResponse(success=True, sid=sid)

        except Exception as exc:
            error_msg = str(exc)
            sentry_sdk.capture_exception(exc)
            _log_notification(
                supabase, body.tenant_id, body.job_id, "sms", "failed", error_msg,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"SMS delivery failed: {error_msg}",
            )


# ---------------------------------------------------------------------------
# POST /notifications/slack
# ---------------------------------------------------------------------------

@router.post("/notifications/slack", response_model=SlackResponse)
async def send_slack(
    body: SlackRequest,
    user: dict = Security(get_current_user),
):
    """Post a message to Slack via an incoming webhook URL.

    Requires: SLACK_WEBHOOK_URL env var.
    Optional: blocks (Block Kit JSON) for richer formatting.
    """
    supabase = get_supabase()

    with sentry_sdk.new_scope() as scope:
        scope.set_tag("job_id",    body.job_id)
        scope.set_tag("tenant_id", body.tenant_id)
        scope.set_tag("channel",   "slack")

        if body.tenant_id != user["tenant_id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="tenant_id in body does not match authenticated tenant",
            )

        try:
            check_rate_limit(body.tenant_id, "slack")
        except RateLimitExceeded as exc:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"error": str(exc), "retry_after": exc.retry_after},
                headers={"Retry-After": str(exc.retry_after)},
            )

        if _check_duplicate(supabase, body.tenant_id, body.job_id, "slack", "alert"):
            _log_notification(
                supabase, body.tenant_id, body.job_id, "slack", "skipped", "deduplicated",
            )
            return SlackResponse(success=True)

        webhook_url = os.getenv("SLACK_WEBHOOK_URL")
        if not webhook_url:
            _log_notification(
                supabase, body.tenant_id, body.job_id, "slack", "skipped",
                "SLACK_WEBHOOK_URL not configured",
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Slack not configured — missing SLACK_WEBHOOK_URL",
            )

        payload: Dict[str, Any] = {"text": body.message}
        if body.blocks:
            payload["blocks"] = body.blocks

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await _with_retry(
                    lambda: client.post(webhook_url, json=payload)
                )
            resp.raise_for_status()

            _log_notification(supabase, body.tenant_id, body.job_id, "slack", "sent")
            return SlackResponse(success=True)

        except Exception as exc:
            error_msg = str(exc)
            sentry_sdk.capture_exception(exc)
            _log_notification(
                supabase, body.tenant_id, body.job_id, "slack", "failed", error_msg,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Slack delivery failed: {error_msg}",
            )


# ---------------------------------------------------------------------------
# GET /notifications/logs
# ---------------------------------------------------------------------------

@router.get("/notifications/logs")
async def get_notification_logs(
    job_id:  Optional[str] = Query(default=None),
    channel: Optional[str] = Query(default=None),
    limit:   int           = Query(default=50, ge=1, le=200),
    offset:  int           = Query(default=0,  ge=0),
    user: dict = Security(get_current_user),
):
    """Return notification_logs for the authenticated tenant.

    Filters
    -------
    job_id   — scope to a single job
    channel  — "email" | "sms" | "slack"
    limit    — max rows returned (default 50, max 200)
    offset   — pagination offset
    """
    supabase = get_supabase()

    query = (
        supabase.table("notification_logs")
        .select(
            "id, tenant_id, job_id, channel, status, sent_at, error_msg",
            count="exact",
        )
        .eq("tenant_id", user["tenant_id"])
        .order("sent_at", desc=True)
        .range(offset, offset + limit - 1)
    )

    if job_id:
        query = query.eq("job_id", job_id)
    if channel:
        query = query.eq("channel", channel)

    try:
        result = query.execute()
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to query notification_logs",
        )

    rows  = result.data  or []
    total = result.count or 0

    return {
        "logs":     rows,
        "total":    total,
        "limit":    limit,
        "offset":   offset,
        "has_more": offset + limit < total,
    }
