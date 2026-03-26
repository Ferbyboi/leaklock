-- Migration 013: Reconciliation immutability + performance indexes
-- ─────────────────────────────────────────────────────────────────

-- 1. Performance index for batch worker queries (tasks.py:batch_process_pending_jobs)
--    Full table scan on field_notes every 4 hours without this.
CREATE INDEX IF NOT EXISTS idx_field_notes_parse_status
    ON field_notes (tenant_id, parse_status)
    WHERE parse_status = 'pending';

-- 2. Performance index for match worker claims
CREATE INDEX IF NOT EXISTS idx_jobs_match_status
    ON jobs (tenant_id, match_status);

-- 3. Extend reconciliation_results status CHECK to include auditor-driven values.
--    The original constraint only had 'clean','discrepancy','error'.
ALTER TABLE reconciliation_results
    DROP CONSTRAINT IF EXISTS reconciliation_results_status_check;

ALTER TABLE reconciliation_results
    ADD CONSTRAINT reconciliation_results_status_check
    CHECK (status IN ('clean', 'discrepancy', 'error', 'false_positive', 'override_approved', 'confirmed'));

-- 4. Immutability trigger — prevent updating core result fields after insert.
--    Auditor annotation fields (auditor_action, auditor_id, reviewed_at) remain writable.
CREATE OR REPLACE FUNCTION prevent_reconciliation_core_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status
        OR OLD.missing_items IS DISTINCT FROM NEW.missing_items
        OR OLD.extra_items IS DISTINCT FROM NEW.extra_items
        OR OLD.estimated_leak_cents IS DISTINCT FROM NEW.estimated_leak_cents
        OR OLD.run_at IS DISTINCT FROM NEW.run_at
        OR OLD.job_id IS DISTINCT FROM NEW.job_id
        OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    THEN
        RAISE EXCEPTION 'reconciliation_results core fields are immutable after insert';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconciliation_immutable ON reconciliation_results;
CREATE TRIGGER trg_reconciliation_immutable
    BEFORE UPDATE ON reconciliation_results
    FOR EACH ROW EXECUTE FUNCTION prevent_reconciliation_core_update();

-- 5. Index to speed up FP-rate Celery Beat query
CREATE INDEX IF NOT EXISTS idx_reconciliation_run_at
    ON reconciliation_results (tenant_id, status, run_at DESC);
