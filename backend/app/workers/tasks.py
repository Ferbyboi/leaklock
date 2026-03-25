import asyncio
import sentry_sdk
from celery import shared_task
from app.celery_app import celery_app  # noqa: F401 — registers tasks with app
from app.db import get_db


def _run(coro):
    """Run an async coroutine from a sync Celery task."""
    return asyncio.run(coro)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, name="tasks.process_field_notes")
def process_field_notes(self, job_id: str, tenant_id: str):
    """
    Step 1 — OCR + AI parse.
    Reads field_notes for the job, runs Tesseract on photos,
    sends text to Claude Sonnet, stores parsed_items.
    """
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("job_id", job_id)
            scope.set_tag("tenant_id", tenant_id)

            db = get_db()

            # Fetch field note
            result = (
                db.table("field_notes")
                .select("id, raw_text, photo_urls")
                .eq("job_id", job_id)
                .eq("tenant_id", tenant_id)
                .single()
                .execute()
            )
            if not result.data:
                raise ValueError(f"No field_notes found for job {job_id}")

            note = result.data
            raw_text = note.get("raw_text") or ""
            photo_urls = note.get("photo_urls") or []

            # OCR photos and append to raw text
            from app.workers.ocr_worker import extract_text_from_photo
            for url in photo_urls:
                try:
                    ocr_text = _run(extract_text_from_photo(url))
                    if ocr_text:
                        raw_text = f"{raw_text}\n{ocr_text}".strip()
                except Exception as ocr_err:
                    sentry_sdk.capture_exception(ocr_err)

            # Haiku pre-screen: skip very short notes (< 10 words)
            word_count = len(raw_text.split())
            if word_count < 10:
                db.table("field_notes").update({
                    "parsed_items": [],
                    "parse_status": "skipped_short",
                }).eq("id", note["id"]).eq("tenant_id", tenant_id).execute()
                return {"skipped": True, "reason": "too_short", "word_count": word_count}

            # Parse with Claude Sonnet
            from app.workers.parse_worker import parse_field_notes
            parsed_items = parse_field_notes(raw_text)

            db.table("field_notes").update({
                "parsed_items": parsed_items,
                "parse_status": "complete",
                "parsed_at": "now()",
            }).eq("id", note["id"]).eq("tenant_id", tenant_id).execute()

            # Chain into reconciliation
            run_three_way_match.delay(job_id, tenant_id)
            return {"parsed": True, "item_count": len(parsed_items)}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, name="tasks.run_three_way_match")
def run_three_way_match(self, job_id: str, tenant_id: str):
    """
    Step 2 — Three-way match + alert.
    Reads parsed field notes, estimates, and draft invoice,
    runs match engine, writes reconciliation_results, fires alert if needed.
    """
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("job_id", job_id)
            scope.set_tag("tenant_id", tenant_id)

            db = get_db()

            # Fetch all three inputs
            estimates_res = (
                db.table("estimates")
                .select("line_items")
                .eq("job_id", job_id)
                .eq("tenant_id", tenant_id)
                .execute()
            )
            field_note_res = (
                db.table("field_notes")
                .select("parsed_items")
                .eq("job_id", job_id)
                .eq("tenant_id", tenant_id)
                .single()
                .execute()
            )
            invoice_res = (
                db.table("draft_invoices")
                .select("line_items")
                .eq("job_id", job_id)
                .eq("tenant_id", tenant_id)
                .single()
                .execute()
            )

            estimate_items = estimates_res.data[0]["line_items"] if estimates_res.data else []
            field_note_items = (field_note_res.data or {}).get("parsed_items") or []
            invoice_items = (invoice_res.data or {}).get("line_items") or []

            from app.core.match_engine import run_three_way_match as match
            result = match(
                estimate_items=estimate_items,
                field_note_items=field_note_items,
                invoice_items=invoice_items,
            )

            # Write immutable reconciliation result (append-only, run_at = now via DB default)
            db.table("reconciliation_results").insert({
                "tenant_id": tenant_id,
                "job_id": job_id,
                "status": result["status"],
                "missing_items": result["missing_items"],
                "extra_items": result["extra_items"],
                "estimated_leak_cents": result["estimated_leak_cents"],
            }).execute()

            # Update job status + match_status
            new_status = "discrepancy" if result["status"] == "discrepancy" else "pending_invoice"
            db.table("jobs").update({
                "status": new_status,
                "match_status": result["status"],
            }).eq("id", job_id).eq("tenant_id", tenant_id).execute()

            if result["status"] == "discrepancy":
                from app.core.alert_engine import fire_revenue_leak_alert
                _run(fire_revenue_leak_alert(job_id, tenant_id, result))

            return {"status": result["status"], "leak_cents": result["estimated_leak_cents"]}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise self.retry(exc=exc)
