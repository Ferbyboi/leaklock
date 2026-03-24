import os
import sentry_sdk
from app.db import get_db

ALERT_THRESHOLD_CENTS = int(os.getenv("ALERT_THRESHOLD_CENTS", "2500"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://app.leaklock.io")


async def fire_revenue_leak_alert(
    job_id: str,
    tenant_id: str,
    match_result: dict,
):
    """Called immediately after a discrepancy is detected.
    Freezes the invoice and fires multi-channel notifications to the tenant owner.
    """
    leak = match_result["estimated_leak_cents"]
    if leak < ALERT_THRESHOLD_CENTS:
        return  # Below threshold — skip notification

    db = get_db()

    # Fetch tenant owner
    owner_res = (
        db.table("users")
        .select("id, email, phone, tenant_id")
        .eq("tenant_id", tenant_id)
        .eq("role", "owner")
        .limit(1)
        .execute()
    )
    tenant_res = (
        db.table("tenants")
        .select("name")
        .eq("id", tenant_id)
        .single()
        .execute()
    )

    owner = owner_res.data[0] if owner_res.data else {}
    biz_name = (tenant_res.data or {}).get("name", "Your business")

    missing_lines = "\n".join(
        f"  • {m['item']} (est. ${m['estimated_leak_cents'] / 100:.2f})"
        for m in match_result["missing_items"]
    )

    message = (
        f"REVENUE LEAK DETECTED — {biz_name}\n"
        f"Job: {job_id}\n"
        f"Unbilled work found in field notes:\n{missing_lines}\n"
        f"Total estimated leak: ${leak / 100:.2f}\n"
        f"Action required: {FRONTEND_URL}/jobs/{job_id}"
    )

    # Freeze the invoice — status held until owner resolves
    db.table("jobs").update({
        "status": "frozen",
        "match_status": "discrepancy",
    }).eq("id", job_id).eq("tenant_id", tenant_id).execute()

    # Multi-channel notifications (best-effort — failures captured to Sentry)
    if os.getenv("SLACK_BOT_TOKEN"):
        try:
            await _send_slack(message)
        except Exception as e:
            sentry_sdk.capture_exception(e)

    if owner.get("email") and os.getenv("SENDGRID_API_KEY"):
        try:
            await _send_email(owner["email"], biz_name, message)
        except Exception as e:
            sentry_sdk.capture_exception(e)

    if owner.get("phone") and os.getenv("TWILIO_ACCOUNT_SID"):
        try:
            await _send_sms(owner["phone"], message[:160])
        except Exception as e:
            sentry_sdk.capture_exception(e)

    # PostHog KPI tracking
    _track_posthog(tenant_id, job_id, leak, match_result)


def _track_posthog(tenant_id: str, job_id: str, leak_cents: int, match_result: dict):
    try:
        import posthog as ph
        ph.api_key = os.getenv("POSTHOG_API_KEY")
        if not ph.api_key:
            return
        ph.capture(
            tenant_id,
            "revenue_leak_detected",
            {
                "job_id": job_id,
                "leak_cents": leak_cents,
                "missing_count": len(match_result["missing_items"]),
                "alert_threshold_cents": ALERT_THRESHOLD_CENTS,
            },
        )
    except Exception:
        pass


def track_false_positive(tenant_id: str, job_id: str, auditor_id: str):
    """Call when auditor marks a leak as a false positive — tracked for KPI."""
    try:
        import posthog as ph
        ph.api_key = os.getenv("POSTHOG_API_KEY")
        if not ph.api_key:
            return
        ph.capture(
            tenant_id,
            "false_positive_marked",
            {"job_id": job_id, "auditor_id": auditor_id},
        )
    except Exception:
        pass


async def _send_slack(message: str):
    from slack_sdk.web.async_client import AsyncWebClient
    client = AsyncWebClient(token=os.getenv("SLACK_BOT_TOKEN"))
    channel = os.getenv("SLACK_ALERTS_CHANNEL", "#revenue-alerts")
    await client.chat_postMessage(channel=channel, text=message)


async def _send_email(to_email: str, biz_name: str, message: str):
    import sendgrid
    from sendgrid.helpers.mail import Mail
    sg = sendgrid.SendGridAPIClient(api_key=os.getenv("SENDGRID_API_KEY"))
    mail = Mail(
        from_email=os.getenv("SENDGRID_FROM_EMAIL", "alerts@leaklock.io"),
        to_emails=to_email,
        subject=f"Unbilled Work Detected — {biz_name}",
        plain_text_content=message,
    )
    sg.send(mail)


async def _send_sms(to_phone: str, message: str):
    from twilio.rest import Client
    client = Client(os.getenv("TWILIO_ACCOUNT_SID"), os.getenv("TWILIO_AUTH_TOKEN"))
    client.messages.create(
        body=message,
        from_=os.getenv("TWILIO_FROM_PHONE"),
        to=to_phone,
    )
