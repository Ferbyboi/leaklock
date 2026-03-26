-- Migration 018: Restaurant extension tables
-- Extends the base restaurant tables created in 006_restaurant_tables.sql
-- with additional columns required by the full niche specification.
-- All tables already have RLS enabled; only new columns are added here.

-- ─────────────────────────────────────────────────────────────────────────────
-- temperature_logs: add warning zone_status value + recorded_at + created_at
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the old CHECK so we can widen the allowed values.
ALTER TABLE temperature_logs
    DROP CONSTRAINT IF EXISTS temperature_logs_zone_status_check;

ALTER TABLE temperature_logs
    ADD CONSTRAINT temperature_logs_zone_status_check
    CHECK (zone_status IN ('safe', 'danger', 'warning'));

ALTER TABLE temperature_logs
    ADD COLUMN IF NOT EXISTS recorded_at  timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now();

-- ─────────────────────────────────────────────────────────────────────────────
-- grease_trap_inspections: add status + next_service_date + created_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE grease_trap_inspections
    ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'ok',
    ADD COLUMN IF NOT EXISTS next_service_date date,
    ADD COLUMN IF NOT EXISTS created_at        timestamptz NOT NULL DEFAULT now();

ALTER TABLE grease_trap_inspections
    ADD CONSTRAINT grease_trap_inspections_status_check
    CHECK (status IN ('ok', 'warning', 'critical', 'frozen'));

-- ─────────────────────────────────────────────────────────────────────────────
-- hood_inspections: add cleanliness NOT NULL enforcement, compliance_status,
--                   notes, inspected_at alias, created_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE hood_inspections
    ADD COLUMN IF NOT EXISTS compliance_status text NOT NULL DEFAULT 'pass',
    ADD COLUMN IF NOT EXISTS notes             text,
    ADD COLUMN IF NOT EXISTS created_at        timestamptz NOT NULL DEFAULT now();

ALTER TABLE hood_inspections
    ADD CONSTRAINT hood_inspections_compliance_status_check
    CHECK (compliance_status IN ('pass', 'fail', 'warning'));

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_health_checks: rename date → check_date, tighten score to integer,
--                      add created_at (already present via created_at DEFAULT)
-- ─────────────────────────────────────────────────────────────────────────────

-- Add check_date as a parallel column so existing data is not lost.
ALTER TABLE daily_health_checks
    ADD COLUMN IF NOT EXISTS check_date date NOT NULL DEFAULT CURRENT_DATE;

-- Backfill from the original date column if it was populated.
UPDATE daily_health_checks
    SET check_date = date
    WHERE check_date = CURRENT_DATE AND date IS NOT NULL;

-- Enforce integer score 0-100 with a named constraint.
ALTER TABLE daily_health_checks
    DROP CONSTRAINT IF EXISTS daily_health_checks_score_check;

ALTER TABLE daily_health_checks
    ADD CONSTRAINT daily_health_checks_score_check
    CHECK (score >= 0 AND score <= 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_temperature_logs_tenant
    ON temperature_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_grease_trap_inspections_tenant
    ON grease_trap_inspections(tenant_id);

CREATE INDEX IF NOT EXISTS idx_hood_inspections_tenant
    ON hood_inspections(tenant_id);

CREATE INDEX IF NOT EXISTS idx_daily_health_checks_tenant
    ON daily_health_checks(tenant_id);
