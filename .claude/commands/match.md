# /match — Run Three-Way Match on a Job

Manually trigger and inspect the three-way match engine for a specific job.

## Usage
`/match <job_id>`

## Steps

1. **Fetch job data from Supabase**
   Use the Supabase MCP or read the DB directly to get:
   - `estimates` line_items for the job
   - `field_notes` parsed_items for the job
   - `draft_invoices` line_items for the job

   If any of the three inputs are missing, report which one and stop.

2. **Run the match engine locally**
   ```python
   from app.core.match_engine import run_three_way_match
   result = run_three_way_match(
       estimate_items=<estimates>,
       field_note_items=<parsed_items>,
       invoice_items=<invoice_items>,
   )
   ```

3. **Report results**
   ```
   Job: <job_id>
   Status: CLEAN | DISCREPANCY
   Estimated leak: $<amount>

   Missing items (in field notes, not on invoice):
   - <item> (qty: X, ~$Y)

   Extra items (on invoice, not in field notes):
   - <item>

   Confidence warnings (< 0.7):
   - <item> at <confidence>
   ```

4. **If DISCREPANCY**: flag whether the job is already frozen or if an alert should be fired.

## Notes
- This is a read-only diagnostic — it does NOT write a reconciliation_results row
- To trigger the full Celery pipeline: use `/ingest <job_id>` instead
