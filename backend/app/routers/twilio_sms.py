"""Twilio SMS inbound webhook — the voice-first tech capture interface.

How it works:
  1. Tech texts a voice memo (or plain text) to the LeakLock Twilio number.
  2. Twilio posts to POST /webhooks/twilio/sms with the message body + media URLs.
  3. We look up the tenant by the tech's phone number.
  4. If audio media is attached → queue Deepgram transcription task.
  5. If plain text → queue Claude parse task directly.
  6. Respond immediately with a TwiML acknowledgment ("Got it, processing…").

Security: Twilio signs every request with HMAC-SHA1. We verify the signature
using RequestValidator from the Twilio SDK. Requests without a valid signature
return 403.

Env vars required:
  TWILIO_AUTH_TOKEN       — for signature validation
  TWILIO_ACCOUNT_SID      — for outbound SMS replies
  TWILIO_FROM_NUMBER      — LeakLock's Twilio number
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from urllib.parse import urlencode

import sentry_sdk
from fastapi import APIRouter, Form, Header, HTTPException, Request
from fastapi.responses import Response

from app.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Twilio signature validation
# ---------------------------------------------------------------------------

def _validate_twilio_signature(
    auth_token: str,
    url: str,
    params: dict,
    x_twilio_signature: str,
) -> bool:
    """Return True if the HMAC-SHA1 signature from Twilio is valid."""
    # Sort params and build the validation string
    s = url + "".join(f"{k}{v}" for k, v in sorted(params.items()))
    expected = hmac.new(
        auth_token.encode(), s.encode(), hashlib.sha1
    ).digest()
    import base64
    return hmac.compare_digest(
        base64.b64encode(expected).decode(),
        x_twilio_signature,
    )


# ---------------------------------------------------------------------------
# Tenant + tech lookup
# ---------------------------------------------------------------------------

def _lookup_tech_by_phone(from_phone: str) -> dict | None:
    """Find the user row (and tenant) for an inbound phone number.

    Twilio delivers numbers in E.164 format: +12125551234.
    We strip the leading + for comparison since some rows may store either format.
    """
    db = get_db()
    normalized = from_phone.lstrip("+")
    # Try exact match first, then strip-plus variant
    for query_phone in [from_phone, normalized, f"+{normalized}"]:
        res = (
            db.table("users")
            .select("id, tenant_id, full_name, phone, notification_prefs")
            .eq("phone", query_phone)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]
    return None


def _get_tenant_type(tenant_id: str) -> str:
    db = get_db()
    res = (
        db.table("tenants")
        .select("tenant_type")
        .eq("id", tenant_id)
        .single()
        .execute()
    )
    return (res.data or {}).get("tenant_type", "restaurant")


# ---------------------------------------------------------------------------
# TwiML helpers
# ---------------------------------------------------------------------------

def _twiml_response(message: str) -> Response:
    """Return a minimal TwiML <Message> response."""
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>{message}</Message>
</Response>"""
    return Response(content=body, media_type="text/xml")


def _send_sms_reply(to: str, body: str) -> None:
    """Fire-and-forget outbound SMS via Twilio REST (sync, called in thread)."""
    try:
        from twilio.rest import Client
        client = Client(
            os.environ["TWILIO_ACCOUNT_SID"],
            os.environ["TWILIO_AUTH_TOKEN"],
        )
        client.messages.create(
            body=body[:160],
            from_=os.environ["TWILIO_FROM_NUMBER"],
            to=to,
        )
    except Exception as exc:
        logger.warning("Failed to send SMS reply to %s: %s", to, exc)


# ---------------------------------------------------------------------------
# Inbound webhook
# ---------------------------------------------------------------------------

@router.post("/webhooks/twilio/sms", include_in_schema=False)
async def twilio_sms_inbound(
    request: Request,
    x_twilio_signature: str = Header(default="", alias="X-Twilio-Signature"),
    From: str = Form(default=""),
    Body: str = Form(default=""),
    NumMedia: str = Form(default="0"),
    MediaUrl0: str = Form(default=""),
    MediaContentType0: str = Form(default=""),
):
    """Receive inbound SMS/MMS from Twilio.

    Validates the Twilio signature, identifies the sending tech, then
    either queues a Deepgram transcription (audio) or a direct Claude
    parse (text).
    """
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")

    # Validate Twilio signature in production (skip if token not set → dev mode)
    if auth_token and x_twilio_signature:
        form_data = await request.form()
        params = dict(form_data)
        url = str(request.url)
        if not _validate_twilio_signature(auth_token, url, params, x_twilio_signature):
            logger.warning("Invalid Twilio signature from %s", From)
            raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    if not From:
        return _twiml_response("⚠️ Could not identify sender.")

    # Look up tech
    tech = _lookup_tech_by_phone(From)
    if not tech:
        logger.warning("Inbound SMS from unknown number %s — no matching user", From)
        return _twiml_response(
            "⚠️ Your number is not registered with LeakLock. "
            "Ask your manager to add you in Settings → Team."
        )

    tenant_id = tech["tenant_id"]
    tech_id = tech["id"]
    tenant_type = _get_tenant_type(tenant_id)
    num_media = int(NumMedia or "0")

    try:
        if num_media > 0 and MediaUrl0 and "audio" in MediaContentType0:
            # Voice memo attachment — queue Deepgram transcription
            from app.workers.tasks import transcribe_and_parse_voice
            transcribe_and_parse_voice.delay(
                media_url=MediaUrl0,
                from_phone=From,
                tech_id=tech_id,
                tenant_id=tenant_id,
                tenant_type=tenant_type,
            )
            return _twiml_response(
                "🎙️ Got your voice note! Transcribing now — "
                "you'll get a confirmation text in ~30 seconds."
            )

        elif Body.strip():
            # Plain text note — queue direct Claude parse
            if len(Body.strip()) < 10:
                return _twiml_response(
                    "⚠️ Message too short. Send a voice memo or more detail."
                )
            from app.workers.tasks import parse_sms_text_note
            parse_sms_text_note.delay(
                text=Body.strip(),
                from_phone=From,
                tech_id=tech_id,
                tenant_id=tenant_id,
                tenant_type=tenant_type,
            )
            return _twiml_response(
                "📋 Got your note! Processing now — "
                "confirmation text coming shortly."
            )

        else:
            return _twiml_response(
                "👋 Hi! Send a voice memo or text note to log compliance data. "
                "Example: 'Chicken breast 167°F, beef 155°F, sanitizer 100ppm.'"
            )

    except Exception as exc:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("tenant_id", tenant_id)
            scope.set_tag("from_phone", From)
            sentry_sdk.capture_exception(exc)
        logger.exception("Error processing inbound SMS from %s", From)
        return _twiml_response(
            "⚠️ We hit a snag processing your message. Try again in a moment."
        )
