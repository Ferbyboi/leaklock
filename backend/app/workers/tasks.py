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


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30, name="tasks.transcribe_and_parse_voice")
def transcribe_and_parse_voice(
    self,
    media_url: str,
    from_phone: str,
    tech_id: str,
    tenant_id: str,
    tenant_type: str,
):
    """Deepgram Nova-3 transcription → Claude parse → SMS confirmation.

    Called when a tech sends a voice memo to the LeakLock Twilio number.
    Steps:
      1. Download audio from Twilio media URL (requires auth).
      2. Send to Deepgram Nova-3 for transcription with niche keywords.
      3. Pre-screen with word count (< 10 words → skip, reply with note).
      4. Load niche system prompt from schema router.
      5. Parse with Claude Sonnet → structured JSON.
      6. Save to field_events table.
      7. Run compliance check.
      8. SMS confirmation back to tech.
    """
    import os
    import uuid
    import httpx

    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("tenant_id", tenant_id)
            scope.set_tag("tech_id", tech_id)

            deepgram_key = os.getenv("DEEPGRAM_API_KEY")
            if not deepgram_key:
                raise RuntimeError("DEEPGRAM_API_KEY not set")

            # 1. Download audio from Twilio (requires Basic auth)
            twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
            twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "")
            with httpx.Client(timeout=30) as http:
                audio_resp = http.get(
                    media_url,
                    auth=(twilio_sid, twilio_token) if twilio_sid else None,
                )
                audio_resp.raise_for_status()
                audio_bytes = audio_resp.content

            # 2. Deepgram Nova-3 transcription
            # Load domain keywords from niche schema for better accuracy
            niche_keywords: list[str] = []
            try:
                from app.core.schema_router import get_schema
                schema = get_schema(tenant_type)
                keywords_raw = schema.get("validation_rules", {}).get("domain_keywords", [])
                niche_keywords = keywords_raw if isinstance(keywords_raw, list) else []
            except Exception:
                pass

            dg_params = {
                "model": "nova-3",
                "smart_format": "true",
                "punctuate": "true",
                "utterances": "false",
            }
            if niche_keywords:
                dg_params["keywords"] = ":".join(niche_keywords[:20])

            dg_url = "https://api.deepgram.com/v1/listen?" + "&".join(
                f"{k}={v}" for k, v in dg_params.items()
            )
            with httpx.Client(timeout=60) as http:
                dg_resp = http.post(
                    dg_url,
                    headers={
                        "Authorization": f"Token {deepgram_key}",
                        "Content-Type": audio_resp.headers.get("Content-Type", "audio/mpeg"),
                    },
                    content=audio_bytes,
                )
                dg_resp.raise_for_status()

            transcript = (
                dg_resp.json()
                .get("results", {})
                .get("channels", [{}])[0]
                .get("alternatives", [{}])[0]
                .get("transcript", "")
                .strip()
            )
            confidence = (
                dg_resp.json()
                .get("results", {})
                .get("channels", [{}])[0]
                .get("alternatives", [{}])[0]
                .get("confidence", 0.0)
            )

            if not transcript or len(transcript.split()) < 5:
                _send_sms_to_tech(from_phone, "⚠️ Couldn't transcribe your voice note. Please speak clearly and try again, or send a text note instead.")
                return {"skipped": True, "reason": "empty_transcript"}

            # 3-5. Parse with Claude using niche prompt
            niche_prompt = None
            try:
                from app.core.schema_router import get_system_prompt
                niche_prompt = get_system_prompt(tenant_type)
            except Exception:
                pass

            from app.workers.parse_worker import parse_field_notes
            parsed_items = parse_field_notes(transcript, niche_system_prompt=niche_prompt)

            # 6. Save to field_events
            db = get_db()
            event_id = str(uuid.uuid4())
            db.table("field_events").insert({
                "id": event_id,
                "tenant_id": tenant_id,
                "user_id": tech_id,
                "event_type": "voice",
                "raw_input": transcript,
                "parsed_data": {"items": parsed_items},
                "confidence": confidence,
                "media_urls": [media_url],
            }).execute()

            # 7. Run compliance check
            try:
                _run_compliance_check(db, event_id, tenant_id, tenant_type, parsed_items)
            except Exception as ce:
                sentry_sdk.capture_exception(ce)

            # 8. SMS confirmation — summarize what was parsed
            confirmation = _format_parse_confirmation(parsed_items, tenant_type)
            _send_sms_to_tech(from_phone, confirmation)

            return {"transcribed": True, "items": len(parsed_items), "confidence": confidence}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        try:
            _send_sms_to_tech(from_phone, "⚠️ Error processing your voice note. Please try again or contact support.")
        except Exception:
            pass
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30, name="tasks.parse_sms_text_note")
def parse_sms_text_note(
    self,
    text: str,
    from_phone: str,
    tech_id: str,
    tenant_id: str,
    tenant_type: str,
):
    """Parse a plain-text SMS note via Claude and send confirmation.

    Used when a tech sends a text message instead of a voice memo.
    """
    import uuid

    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("tenant_id", tenant_id)
            scope.set_tag("tech_id", tech_id)

            niche_prompt = None
            try:
                from app.core.schema_router import get_system_prompt
                niche_prompt = get_system_prompt(tenant_type)
            except Exception:
                pass

            from app.workers.parse_worker import parse_field_notes
            parsed_items = parse_field_notes(text, niche_system_prompt=niche_prompt)

            db = get_db()
            event_id = str(uuid.uuid4())
            db.table("field_events").insert({
                "id": event_id,
                "tenant_id": tenant_id,
                "user_id": tech_id,
                "event_type": "text",
                "raw_input": text,
                "parsed_data": {"items": parsed_items},
                "confidence": 1.0,
                "media_urls": [],
            }).execute()

            try:
                _run_compliance_check(db, event_id, tenant_id, tenant_type, parsed_items)
            except Exception as ce:
                sentry_sdk.capture_exception(ce)

            confirmation = _format_parse_confirmation(parsed_items, tenant_type)
            _send_sms_to_tech(from_phone, confirmation)

            return {"parsed": True, "items": len(parsed_items)}

    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        try:
            _send_sms_to_tech(from_phone, "⚠️ Error processing your note. Please try again.")
        except Exception:
            pass
        raise self.retry(exc=exc)


@celery_app.task(name="tasks.send_daily_check_reminders")
def send_daily_check_reminders():
    """Celery Beat — 10 PM UTC daily. 'You Forgot Something' compliance reminder.

    For each tenant, checks which required_daily_checks from the niche schema
    were NOT completed today. If any are missing, texts the owner.
    """
    import os
    from datetime import datetime, timezone

    db = get_db()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Fetch all active tenants
    tenants_res = (
        db.table("tenants")
        .select("id, name, tenant_type")
        .neq("plan", "cancelled")
        .execute()
    )
    tenants = tenants_res.data or []

    sent = 0
    for tenant in tenants:
        tenant_id = tenant["id"]
        tenant_type = tenant.get("tenant_type", "restaurant")
        tenant_name = tenant.get("name", "Your business")

        try:
            # Load required daily checks for this niche
            from app.core.schema_router import get_schema
            schema = get_schema(tenant_type)
            required_checks: list[str] = schema.get("required_daily_checks", [])
            if not required_checks:
                continue

            # Count today's completed field events for this tenant
            events_res = (
                db.table("field_events")
                .select("parsed_data")
                .eq("tenant_id", tenant_id)
                .gte("created_at", f"{today}T00:00:00+00:00")
                .execute()
            )
            completed_types = set()
            for ev in events_res.data or []:
                items = (ev.get("parsed_data") or {}).get("items", [])
                for item in items:
                    if isinstance(item, dict):
                        completed_types.add(item.get("type", "").lower())
                        completed_types.add(item.get("check", "").lower())

            # Find which required checks were NOT done
            missing = [c for c in required_checks if c.lower() not in completed_types]
            if not missing:
                continue

            # Fetch owner phone
            owner_res = (
                db.table("users")
                .select("phone, email")
                .eq("tenant_id", tenant_id)
                .eq("role", "owner")
                .limit(1)
                .execute()
            )
            if not owner_res.data:
                continue
            owner = owner_res.data[0]
            phone = owner.get("phone", "")
            if not phone or not os.getenv("TWILIO_ACCOUNT_SID"):
                continue

            missing_str = ", ".join(missing[:3])
            suffix = f" (+{len(missing) - 3} more)" if len(missing) > 3 else ""
            msg = (
                f"⚠️ {tenant_name} — {len(missing)} check{'s' if len(missing) != 1 else ''} "
                f"missing today:\n{missing_str}{suffix}\n"
                f"Compliance score may be affected. Text your techs to complete before midnight."
            )
            _send_sms_to_tech(phone, msg)
            sent += 1

        except Exception as exc:
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("tenant_id", tenant_id)
                sentry_sdk.capture_exception(exc)

    return {"tenants_checked": len(tenants), "reminders_sent": sent}


@celery_app.task(name="tasks.send_weekly_money_email")
def send_weekly_money_email():
    """Celery Beat — Every Friday at 18:00 UTC. 'Money You Almost Lost' digest.

    For each tenant owner with a valid email, sends a weekly summary:
    - Total jobs processed
    - Unbilled items caught + dollar value recovered
    - Compliance score for the week
    - What the team missed
    """
    import os
    import asyncio
    from datetime import datetime, timedelta, timezone

    db = get_db()
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    frontend_url = os.getenv("FRONTEND_URL", "https://app.leaklock.io")

    # Fetch all active tenants with owner emails
    tenants_res = (
        db.table("tenants")
        .select("id, name, tenant_type")
        .neq("plan", "cancelled")
        .execute()
    )

    sent = 0
    for tenant in tenants_res.data or []:
        tenant_id = tenant["id"]
        tenant_name = tenant.get("name", "Your business")

        try:
            # Get owner email
            owner_res = (
                db.table("users")
                .select("email, full_name")
                .eq("tenant_id", tenant_id)
                .eq("role", "owner")
                .limit(1)
                .execute()
            )
            if not owner_res.data:
                continue
            owner = owner_res.data[0]
            email = owner.get("email", "")
            owner_name = owner.get("full_name") or "there"
            if not email or not os.getenv("RESEND_API_KEY"):
                continue

            # Jobs processed this week
            jobs_res = (
                db.table("jobs")
                .select("id, status")
                .eq("tenant_id", tenant_id)
                .gte("created_at", week_ago)
                .execute()
            )
            jobs = jobs_res.data or []
            total_jobs = len(jobs)

            # Reconciliation results this week
            rec_res = (
                db.table("reconciliation_results")
                .select("status, estimated_leak_cents, missing_items, auditor_action")
                .eq("tenant_id", tenant_id)
                .gte("run_at", week_ago)
                .execute()
            )
            results = rec_res.data or []
            leaks = [r for r in results if r.get("status") in ("discrepancy", "error")]
            total_leak_cents = sum(r.get("estimated_leak_cents") or 0 for r in leaks)
            confirmed = [r for r in results if r.get("auditor_action") == "confirm_leak"]
            recovered_cents = sum(r.get("estimated_leak_cents") or 0 for r in confirmed)

            # Field events this week
            events_res = (
                db.table("field_events")
                .select("id")
                .eq("tenant_id", tenant_id)
                .gte("created_at", week_ago)
                .execute()
            )
            total_captures = len(events_res.data or [])

            if total_jobs == 0 and total_captures == 0:
                continue  # Nothing to report

            # Build email body
            recovered_str = f"${recovered_cents / 100:,.2f}" if recovered_cents else "$0"
            at_risk_str = f"${total_leak_cents / 100:,.2f}" if total_leak_cents else "$0"

            subject = (
                f"LeakLock Weekly: {recovered_str} recovered"
                if recovered_cents
                else f"LeakLock Weekly — {tenant_name} summary"
            )

            missing_items_all: list[str] = []
            for r in leaks[:5]:
                items = r.get("missing_items") or []
                for item in items:
                    if isinstance(item, dict):
                        missing_items_all.append(item.get("item", "Unknown item"))
                    elif isinstance(item, str):
                        missing_items_all.append(item)

            missed_section = ""
            if missing_items_all:
                missed_lines = "\n".join(f"  • {i}" for i in missing_items_all[:10])
                missed_section = f"\nItems your team almost missed billing:\n{missed_lines}\n"

            body = (
                f"Hi {owner_name},\n\n"
                f"Here's your LeakLock weekly summary for {tenant_name}:\n\n"
                f"📋 Field captures logged: {total_captures}\n"
                f"🔧 Jobs processed: {total_jobs}\n"
                f"🚨 Revenue leaks detected: {len(leaks)} ({at_risk_str} at risk)\n"
                f"✅ Revenue recovered: {recovered_str}\n"
                f"{missed_section}\n"
                f"View your full dashboard: {frontend_url}/dashboard\n\n"
                f"— The LeakLock Team\n"
                f"Unsubscribe: {frontend_url}/settings/notifications"
            )

            # Send via Resend
            import resend
            resend.api_key = os.environ["RESEND_API_KEY"]
            from_addr = os.getenv("RESEND_FROM_EMAIL", "weekly@leaklock.io")
            resend.Emails.send({
                "from": from_addr,
                "to": email,
                "subject": subject,
                "text": body,
            })
            sent += 1

        except Exception as exc:
            with sentry_sdk.new_scope() as scope:
                scope.set_tag("tenant_id", tenant_id)
                sentry_sdk.capture_exception(exc)

    return {"emails_sent": sent}


# ---------------------------------------------------------------------------
# Shared helpers used by SMS tasks
# ---------------------------------------------------------------------------

def _send_sms_to_tech(to_phone: str, body: str) -> None:
    """Outbound SMS to a tech (confirmation or error). Best-effort."""
    import os
    try:
        from twilio.rest import Client
        client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
        client.messages.create(
            body=body[:320],
            from_=os.environ["TWILIO_FROM_NUMBER"],
            to=to_phone,
        )
    except Exception as exc:
        sentry_sdk.capture_exception(exc)


def _run_compliance_check(db, event_id: str, tenant_id: str, tenant_type: str, parsed_items: list) -> None:
    """Check parsed items against niche validation rules; insert compliance_checks row."""
    import uuid
    from app.core.schema_router import get_validation_rules

    rules = get_validation_rules(tenant_type)
    violations: list[dict] = []
    score = 100

    for item in parsed_items:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type", "").lower()

        # Temperature checks (restaurant)
        if item_type == "temperature" and tenant_type == "restaurant":
            temp = item.get("temp_f") or item.get("value")
            food = item.get("item", "").lower()
            if temp is not None:
                if "chicken" in food and float(temp) < rules.get("chicken_min_internal_f", 165):
                    violations.append({"rule": "chicken_min_internal_f", "value": temp, "item": food})
                    score -= 20
                elif "beef" in food and float(temp) < rules.get("ground_beef_min_internal_f", 155):
                    violations.append({"rule": "ground_beef_min_internal_f", "value": temp, "item": food})
                    score -= 20

        # Refrigerant leak rate (HVAC)
        if item_type == "leak_rate" and tenant_type in ("hvac", "plumbing"):
            rate = item.get("rate_pct") or item.get("value")
            threshold = rules.get("comfort_cooling_leak_threshold_pct", 10)
            if rate is not None and float(rate) > threshold:
                violations.append({"rule": "leak_rate_exceeded", "value": rate, "threshold": threshold})
                score -= 30

    status = "fail" if violations else "pass"
    db.table("compliance_checks").insert({
        "id": str(uuid.uuid4()),
        "field_event_id": event_id,
        "schema_version": "1.0.0",
        "status": status,
        "violations": violations,
        "score": max(0, score),
        "checked_at": "now()",
    }).execute()


def _format_parse_confirmation(parsed_items: list, tenant_type: str) -> str:
    """Format a concise SMS confirmation for the tech."""
    if not parsed_items:
        return "✓ Logged. No structured items extracted — raw note saved."

    lines: list[str] = []
    warnings: list[str] = []

    for item in parsed_items[:6]:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type", "").lower()

        if item_type == "temperature":
            temp = item.get("temp_f") or item.get("value", "?")
            food = item.get("item", "item")
            zone = item.get("zone", "")
            icon = "⚠️" if zone == "danger" else "✓"
            line = f"{icon} {food}: {temp}°F"
            if zone == "danger":
                warnings.append(line)
            else:
                lines.append(line)
        elif item_type == "sanitizer":
            ppm = item.get("ppm", item.get("value", "?"))
            lines.append(f"✓ Sanitizer: {ppm}ppm")
        elif item_type == "refrigerant":
            ref = item.get("refrigerant_type", "refrigerant")
            qty = item.get("qty_lbs", item.get("value", "?"))
            lines.append(f"✓ {ref}: {qty}lbs")
        elif item_type == "safety_check":
            check = item.get("check", "check")
            passed = item.get("passed", True)
            icon = "✓" if passed else "⚠️"
            lines.append(f"{icon} {check}")
        else:
            desc = item.get("description") or item.get("item") or item.get("type", "item")
            lines.append(f"✓ {desc}")

    all_lines = warnings + lines
    summary = "\n".join(all_lines[:6])
    warning_note = " ⚠️ VIOLATIONS DETECTED — check dashboard." if warnings else ""
    return f"LeakLock logged:{warning_note}\n{summary}"


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
