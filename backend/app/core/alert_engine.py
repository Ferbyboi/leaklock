import asyncio
import logging
import os
import sentry_sdk
from app.db import get_db

logger = logging.getLogger(__name__)

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

    # Slack is workspace-level — fires regardless of owner existence
    if os.getenv("SLACK_WEBHOOK_URL"):
        try:
            await _send_slack(message)
        except Exception as e:
            sentry_sdk.capture_exception(e)

    # Email and SMS require owner contact info
    if not owner_res.data:
        logger.warning("No owner found for tenant %s — skipping email/SMS notification", tenant_id)
        return

    owner = owner_res.data[0]

    if owner.get("email") and os.getenv("RESEND_API_KEY"):
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
    import httpx
    webhook_url = os.getenv("SLACK_WEBHOOK_URL")
    if not webhook_url:
        return
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(webhook_url, json={"text": message})
        r.raise_for_status()


async def _send_email(to_email: str, biz_name: str, message: str):
    import resend
    resend.api_key = os.getenv("RESEND_API_KEY")
    payload = {
        "from": os.getenv("RESEND_FROM_EMAIL", "alerts@leaklock.io"),
        "to": [to_email],
        "subject": f"Unbilled Work Detected — {biz_name}",
        "text": message,
    }
    await asyncio.to_thread(resend.Emails.send, payload)


async def _send_sms(to_phone: str, message: str):
    from twilio.rest import Client
    client = Client(os.getenv("TWILIO_ACCOUNT_SID"), os.getenv("TWILIO_AUTH_TOKEN"))
    from_number = os.getenv("TWILIO_FROM_NUMBER")
    await asyncio.to_thread(
        client.messages.create,
        body=message,
        from_=from_number,
        to=to_phone,
    )
