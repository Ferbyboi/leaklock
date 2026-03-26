import asyncio
import sentry_sdk
from celery import shared_task
from app.celery_app import celery_app  # noqa: F401 — registers tasks with app
from app.db import get_db


def _run(coro):
    """Run an async coroutine from a sync Celery task."""
    return asyncio.run(coro)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, name="tasks.process_field_notes",
                 on_failure=lambda self, exc, task_id, args, kwargs, einfo:
                     _notify_owner_parse_failure(args[0], args[1], str(exc)))
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

            # Atomic claim — skip if another worker already grabbed this note
            claim = (
                db.table("field_notes")
                .update({"parse_status": "processing"})
                .eq("id", note["id"])
                .eq("tenant_id", tenant_id)
                .eq("parse_status", "pending")
                .execute()
            )
            if not claim.data:
                return {"skipped": True, "reason": "already_processing_or_complete"}

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

            # Load niche-specific system prompt if tenant has a type
            niche_prompt = None
            try:
                tenant_res = (
                    db.table("tenants")
                    .select("tenant_type")
                    .eq("id", tenant_id)
                    .single()
                    .execute()
                )
                tenant_type = (tenant_res.data or {}).get("tenant_type")
                if tenant_type:
                    from app.core.schema_router import get_system_prompt
                    niche_prompt = get_system_prompt(tenant_type)
            except Exception:
                pass  # Fall back to generic prompt if schema lookup fails

            # Parse with Claude Sonnet
            from app.workers.parse_worker import parse_field_notes
            parsed_items = parse_field_notes(raw_text, niche_system_prompt=niche_prompt)

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

            # Atomic claim — set match_status to 'reconciling' only if not already claimed
            job_claim = (
                db.table("jobs")
                .update({"match_status": "reconciling"})
                .eq("id", job_id)
                .eq("tenant_id", tenant_id)
                .neq("match_status", "reconciling")
                .execute()
            )
            if not job_claim.data:
                return {"skipped": True, "reason": "already_reconciling"}

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
                # Fire notifications asynchronously — don't block the match worker
                send_revenue_alert.delay(job_id, tenant_id, result)

            return {"status": result["status"], "leak_cents": result["estimated_leak_cents"]}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30, name="tasks.generate_embeddings")
def generate_embeddings(self, record_id: str, table: str, tenant_id: str, text: str):
    """Generate a vector embedding and store it in pgvector.

    Called after field_notes or draft_invoices are written.
    Enables semantic similarity search for smarter three-way matching.

    Args:
        record_id:  UUID of the row to update.
        table:      "field_notes" or "draft_invoices".
        tenant_id:  Tenant scope — verified before writing.
        text:       Text to embed (raw_text for notes, serialised line_items for invoices).
    """
    import os

    VALID_TABLES = {"field_notes", "draft_invoices"}
    if table not in VALID_TABLES:
        raise ValueError(f"Invalid table for embedding: {table}")

    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("record_id", record_id)
            scope.set_tag("table", table)
            scope.set_tag("tenant_id", tenant_id)

            if not text or not text.strip():
                return {"skipped": True, "reason": "empty_text"}

            voyage_key = os.getenv("VOYAGE_API_KEY")
            if not voyage_key:
                return {"skipped": True, "reason": "no_voyage_key"}

            import httpx

            # Truncate to stay within voyage-3 token limit (~32k tokens)
            truncated = text[:24000]

            resp = httpx.post(
                "https://api.voyageai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {voyage_key}"},
                json={"input": truncated, "model": "voyage-3"},
                timeout=30,
            )
            resp.raise_for_status()
            vector = resp.json()["data"][0]["embedding"]

            db = get_db()
            db.table(table).update(
                {"embedding": vector}
            ).eq("id", record_id).eq("tenant_id", tenant_id).execute()

            return {"embedded": True, "dimensions": len(vector)}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise self.retry(exc=exc)


@celery_app.task(name="tasks.check_false_positive_rate")
def check_false_positive_rate():
    """Celery Beat daily task — compute 7-day false positive rate and alert if > 5%.

    KPI target from CLAUDE.md: false positive rate < 5%.
    Fires a Slack alert + PostHog event when the threshold is breached.
    """
    import os
    from datetime import datetime, timedelta, timezone

    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    # Include all statuses that started as a discrepancy (reviewed and unreviewed)
    result = (
        db.table("reconciliation_results")
        .select("status, auditor_action")
        .in_("status", ["discrepancy", "false_positive", "confirmed", "override_approved"])
        .gte("run_at", cutoff)
        .execute()
    )
    rows = result.data or []

    total_alerts = len(rows)
    false_positives = sum(1 for r in rows if r.get("auditor_action") == "false_positive")

    if total_alerts == 0:
        return {"fp_rate": 0, "total_alerts": 0, "false_positives": 0, "alerted": False}

    fp_rate = false_positives / total_alerts
    threshold = float(os.getenv("FP_RATE_ALERT_THRESHOLD", "0.05"))

    # Track in PostHog regardless
    try:
        import posthog as ph
        ph.api_key = os.getenv("POSTHOG_API_KEY")
        if ph.api_key:
            ph.capture(
                "system",
                "fp_rate_computed",
                {
                    "fp_rate": round(fp_rate, 4),
                    "false_positives": false_positives,
                    "total_alerts": total_alerts,
                    "window_days": 7,
                    "threshold_breached": fp_rate > threshold,
                },
            )
    except Exception as exc:
        sentry_sdk.capture_exception(exc)

    if fp_rate <= threshold:
        return {"fp_rate": fp_rate, "total_alerts": total_alerts, "false_positives": false_positives, "alerted": False}

    # Breach — fire Slack alert
    message = (
        f":rotating_light: *LeakLock FP Rate Alert*\n"
        f"7-day false positive rate is *{fp_rate:.1%}* (threshold: {threshold:.0%})\n"
        f"{false_positives} false positives out of {total_alerts} alerts.\n"
        f"Review recent reconciliations at {os.getenv('FRONTEND_URL', 'https://app.leaklock.io')}/auditor"
    )
    slack_webhook = os.getenv("SLACK_WEBHOOK_URL")
    if slack_webhook:
        try:
            import httpx
            httpx.post(slack_webhook, json={"text": message}, timeout=10)
        except Exception as exc:
            sentry_sdk.capture_exception(exc)

    sentry_sdk.capture_message(
        f"FP rate breached: {fp_rate:.1%} over last 7 days "
        f"({false_positives} false positives / {total_alerts} alerts)",
        level="warning",
    )

    return {"fp_rate": fp_rate, "total_alerts": total_alerts, "false_positives": false_positives, "alerted": True}


@celery_app.task(name="tasks.batch_process_pending_jobs")
def batch_process_pending_jobs():
    """Celery Beat periodic task — process low-value jobs every 4 hours.

    Per cost optimisation rules: jobs estimated under $200 are batched
    every 4 hours instead of being parsed in real-time.
    """
    db = get_db()

    result = (
        db.table("field_notes")
        .select("id, job_id, tenant_id")
        .eq("parse_status", "pending")
        .execute()
    )

    rows = result.data or []
    if not rows:
        return {"queued": 0}

    queued = 0
    for row in rows:
        try:
            est = (
                db.table("estimates")
                .select("line_items")
                .eq("job_id", row["job_id"])
                .eq("tenant_id", row["tenant_id"])
                .execute()
            )
            items = (est.data[0].get("line_items") or []) if est.data else []
            total_cents = sum(
                int(i.get("unit_price_cents", 0)) * float(i.get("qty", 1))
                for i in items
            )

            if total_cents < 20000:  # under $200 — defer to batch
                process_field_notes.delay(row["job_id"], row["tenant_id"])
                queued += 1
        except Exception as exc:
            sentry_sdk.capture_exception(exc)

    return {"queued": queued, "total_pending": len(rows)}


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60, name="tasks.send_revenue_alert")
def send_revenue_alert(self, job_id: str, tenant_id: str, match_result: dict):
    """Async notification dispatch — runs outside the match worker.

    Sends Slack / email / SMS for a detected revenue leak.
    Keeps `run_three_way_match` non-blocking.
    """
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("job_id", job_id)
            scope.set_tag("tenant_id", tenant_id)

            from app.core.alert_engine import fire_revenue_leak_alert
            _run(fire_revenue_leak_alert(job_id, tenant_id, match_result))

        return {"sent": True}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        raise self.retry(exc=exc)


@celery_app.task(name="tasks.cleanup_old_alerts")
def cleanup_old_alerts():
    """Nightly — delete acknowledged alerts older than 90 days to keep the table lean."""
    from datetime import datetime, timedelta, timezone
    db = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    result = (
        db.table("alerts")
        .delete()
        .is_not("acknowledged_at", "null")
        .lt("acknowledged_at", cutoff)
        .execute()
    )
    return {"deleted": len(result.data or [])}


def _notify_owner_parse_failure(job_id: str, tenant_id: str, error_msg: str):
    """Create an in-app critical alert when field-note parsing exhausts all retries."""
    try:
        import uuid
        db = get_db()
        db.table("alerts").insert({
            "id":        str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "job_id":    job_id,
            "title":     f"Parsing failed for job {job_id[:8]}",
            "body":      f"Field note parsing failed after all retries: {error_msg[:200]}",
            "severity":  "critical",
            "alert_type": "parse_failure",
        }).execute()
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
