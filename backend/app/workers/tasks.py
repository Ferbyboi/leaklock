from celery import shared_task
from app.workers.ocr_worker import aggregate_field_text
from app.workers.parse_worker import parse_field_notes
from app.db import get_db
import sentry_sdk


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def process_field_notes(self, job_id: str, tenant_id: str):
    """Parse all field data for a job. Called by webhook on job completion."""
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag('job_id', job_id)
            scope.set_tag('tenant_id', tenant_id)

            db = get_db()
            raw_text = aggregate_field_text(job_id, db)
            parsed = parse_field_notes(raw_text)

            db.execute(
                'UPDATE field_notes SET parsed_items=$1, parse_status=$2, '
                'parsed_at=now() WHERE job_id=$3 AND tenant_id=$4',
                [parsed, 'complete', job_id, tenant_id]
            )

            # Chain immediately into reconciliation
            run_three_way_match.delay(job_id, tenant_id)

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def run_three_way_match(self, job_id: str, tenant_id: str):
    """Run reconciliation after field notes are parsed."""
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag('job_id', job_id)
            scope.set_tag('tenant_id', tenant_id)

            from app.core.match_engine import run_three_way_match as match
            from app.core.alert_engine import fire_revenue_leak_alert
            from app.db import get_db

            db = get_db()

            estimates = db.fetch(
                'SELECT line_items FROM estimates WHERE job_id=$1 AND tenant_id=$2',
                job_id, tenant_id
            )
            field_notes = db.fetchrow(
                'SELECT parsed_items FROM field_notes WHERE job_id=$1 AND tenant_id=$2',
                job_id, tenant_id
            )
            invoice = db.fetchrow(
                'SELECT line_items FROM draft_invoices WHERE job_id=$1 AND tenant_id=$2',
                job_id, tenant_id
            )

            result = match(
                estimate_items=estimates[0]['line_items'] if estimates else [],
                field_note_items=field_notes['parsed_items'] or [],
                invoice_items=invoice['line_items'] if invoice else [],
            )

            db.execute(
                'INSERT INTO reconciliation_results '
                '(tenant_id, job_id, status, missing_items, extra_items, estimated_leak_cents) '
                'VALUES ($1, $2, $3, $4, $5, $6)',
                tenant_id, job_id, result['status'],
                result['missing_items'], result['extra_items'],
                result['estimated_leak_cents']
            )

            if result['status'] == 'discrepancy':
                fire_revenue_leak_alert(job_id, tenant_id, result)

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise self.retry(exc=exc)
