# /ingest — Trigger Field Note Parsing for a Job

Manually trigger the Celery parse pipeline for a specific job.

## Usage
`/ingest <job_id>`

## Steps

1. **Verify the job exists**
   Check that the job_id exists in the `jobs` table and belongs to the correct tenant.
   If not found, stop and report.

2. **Check parse status**
   Read `field_notes.parse_status` for this job:
   - `pending` → safe to parse
   - `complete` → **STOP** — parsed_items is immutable, do not re-parse. Report current parsed_items.
   - `skipped_short` → safe to re-parse if raw_text has been updated
   - `in_progress` → a Celery task is already running, do not duplicate

3. **Queue the Celery task**
   Call the `/jobs/<job_id>/parse` API endpoint:
   ```
   POST https://leaklock-production.up.railway.app/jobs/<job_id>/parse
   Authorization: Bearer <admin_token>
   ```
   Or directly via Python if running locally:
   ```python
   from app.workers.tasks import process_field_notes
   task = process_field_notes.delay(job_id, tenant_id)
   print(f"Task queued: {task.id}")
   ```

4. **Report**
   ```
   Job: <job_id>
   Task ID: <celery_task_id>
   Status: queued

   Monitor at: https://leaklock-production.up.railway.app/jobs/<job_id>
   ```

## Rules
- NEVER re-parse a job with parse_status = "complete" (immutability rule)
- Always include tenant_id when calling tasks directly
- If the Celery worker is down, the task will retry up to 3 times (60s delay)
