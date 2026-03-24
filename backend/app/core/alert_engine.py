import os
import sentry_sdk
from app.db import get_db

ALERT_THRESHOLD_CENTS = int(os.getenv('ALERT_THRESHOLD_CENTS', 2500))


async def fire_revenue_leak_alert(
    job_id: str,
    tenant_id: str,
    match_result: dict,
):
    """Called immediately after a discrepancy is detected."""
    leak = match_result['estimated_leak_cents']
    if leak < ALERT_THRESHOLD_CENTS:
        return  # Below threshold — log only

    db = get_db()
    owner = await db.fetchrow(
        'SELECT u.*, t.name as biz_name FROM users u '
        'JOIN tenants t ON t.id = u.tenant_id '
        'WHERE u.tenant_id=$1 AND u.role=$2',
        tenant_id, 'owner'
    )

    missing_lines = '\n'.join(
        f"  • {m['item']} (est. ${m['estimated_leak_cents']/100:.2f})"
        for m in match_result['missing_items']
    )

    message = (
        f'■ REVENUE LEAK DETECTED — {owner["biz_name"]}\n'
        f'Job: {job_id}\n'
        f'Unbilled work found in field notes:\n{missing_lines}\n'
        f'Total estimated leak: ${leak/100:.2f}\n'
        f'Action required: https://app.leaklock.io/jobs/{job_id}'
    )

    # Freeze the invoice
    await db.execute(
        'UPDATE jobs SET status=$1, match_status=$2 WHERE id=$3',
        'invoice_held', 'discrepancy', job_id
    )

    # Multi-channel notification
    await _send_slack(message)
    await _send_email(owner['email'], message)
    if owner.get('phone'):
        await _send_sms(owner['phone'], message[:160])

    # PostHog KPI tracking
    try:
        import posthog
        posthog.capture(tenant_id, 'revenue_leak_detected', {
            'job_id': job_id,
            'leak_cents': leak,
            'missing_count': len(match_result['missing_items']),
        })
    except Exception:
        pass


async def _send_slack(message: str):
    from slack_sdk.web.async_client import AsyncWebClient
    client = AsyncWebClient(token=os.getenv('SLACK_BOT_TOKEN'))
    channel = os.getenv('SLACK_ALERTS_CHANNEL', '#revenue-alerts')
    await client.chat_postMessage(channel=channel, text=message)


async def _send_email(to_email: str, message: str):
    import sendgrid
    from sendgrid.helpers.mail import Mail
    sg = sendgrid.SendGridAPIClient(api_key=os.getenv('SENDGRID_API_KEY'))
    mail = Mail(
        from_email=os.getenv('SENDGRID_FROM_EMAIL', 'alerts@leaklock.io'),
        to_emails=to_email,
        subject='■ Unbilled Work Detected',
        plain_text_content=message
    )
    sg.send(mail)


async def _send_sms(to_phone: str, message: str):
    from twilio.rest import Client
    client = Client(os.getenv('TWILIO_ACCOUNT_SID'), os.getenv('TWILIO_AUTH_TOKEN'))
    client.messages.create(
        body=message,
        from_=os.getenv('TWILIO_FROM_PHONE'),
        to=to_phone
    )
