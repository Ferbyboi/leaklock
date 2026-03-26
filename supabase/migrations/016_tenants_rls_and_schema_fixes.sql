-- Migration 016: Tenants RLS + schema fixes
-- ─────────────────────────────────────────

-- 1. Tenants table was missing RLS entirely (CRITICAL security gap).
--    Owners can read/update their own tenant; service role bypasses for backend.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_select ON tenants
    FOR SELECT USING (
        id = (auth.jwt()->>'tenant_id')::uuid
    );

CREATE POLICY tenants_update ON tenants
    FOR UPDATE USING (
        id = (auth.jwt()->>'tenant_id')::uuid
    );

-- 2. Fix reconciliation_results immutability trigger (Migration 013) —
--    the trigger was blocking ALL status changes, including legitimate
--    auditor workflow updates (false_positive, override_approved, confirmed).
--    Only the data-integrity fields should be immutable, not status.
CREATE OR REPLACE FUNCTION prevent_reconciliation_core_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- status IS intentionally mutable — auditors update it during review.
    -- Only protect the core data fields that must never change after insert.
    IF OLD.missing_items IS DISTINCT FROM NEW.missing_items
        OR OLD.extra_items IS DISTINCT FROM NEW.extra_items
        OR OLD.estimated_leak_cents IS DISTINCT FROM NEW.estimated_leak_cents
        OR OLD.run_at IS DISTINCT FROM NEW.run_at
        OR OLD.job_id IS DISTINCT FROM NEW.job_id
        OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    THEN
        RAISE EXCEPTION 'reconciliation_results data fields are immutable after insert';
    END IF;
    RETURN NEW;
END;
$$;

-- 3. Add parse_status CHECK constraint (was missing — any string was accepted).
ALTER TABLE field_notes
    ADD CONSTRAINT field_notes_parse_status_check
    CHECK (parse_status IN ('pending', 'processing', 'complete', 'skipped_short', 'error'));

-- 4. Ensure seat_limit has a sensible default for pre-billing tenants.
ALTER TABLE tenants
    ALTER COLUMN seat_limit SET DEFAULT 2;

UPDATE tenants
    SET seat_limit = 2
    WHERE seat_limit IS NULL;

-- 5. Add crm_account_id for CRM-to-tenant mapping (used by Jobber/ServiceTitan webhooks).
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS crm_account_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_crm_account_id
    ON tenants(crm_account_id)
    WHERE crm_account_id IS NOT NULL;
