-- Migration 019: HVAC / Plumbing extension tables
-- Extends the base HVAC tables created in 007_hvac_tree_tables.sql
-- with additional columns required by the full niche specification.

-- ─────────────────────────────────────────────────────────────────────────────
-- refrigerant_logs: rename/add columns to match full spec
--   spec adds: qty_lbs, tech_epa_cert, epa_cert_verified, recorded_at, created_at
--   007 has:   amount_lbs, technician_cert, logged_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE refrigerant_logs
    ADD COLUMN IF NOT EXISTS qty_lbs          numeric(8,3),
    ADD COLUMN IF NOT EXISTS tech_epa_cert    text,
    ADD COLUMN IF NOT EXISTS epa_cert_verified bool NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS recorded_at      timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_at       timestamptz NOT NULL DEFAULT now();

-- Backfill new columns from legacy equivalents where they haven't been set.
UPDATE refrigerant_logs
    SET qty_lbs       = amount_lbs
    WHERE qty_lbs IS NULL AND amount_lbs IS NOT NULL;

UPDATE refrigerant_logs
    SET tech_epa_cert = technician_cert
    WHERE tech_epa_cert IS NULL AND technician_cert IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- leak_rate_calcs: add threshold_exceeded, system_type, calc_date, created_at
--   007 has: leak_rate_pct, threshold_pct, compliance_status, calculated_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leak_rate_calcs
    ADD COLUMN IF NOT EXISTS rate_pct            numeric(5,2),
    ADD COLUMN IF NOT EXISTS threshold_exceeded  bool NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS system_type         text,
    ADD COLUMN IF NOT EXISTS calc_date           date,
    ADD COLUMN IF NOT EXISTS created_at          timestamptz NOT NULL DEFAULT now();

ALTER TABLE leak_rate_calcs
    ADD CONSTRAINT leak_rate_calcs_system_type_check
    CHECK (system_type IN ('commercial_refrigeration', 'industrial_process', 'comfort_cooling'));

-- Backfill rate_pct from legacy leak_rate_pct.
UPDATE leak_rate_calcs
    SET rate_pct  = leak_rate_pct
    WHERE rate_pct IS NULL AND leak_rate_pct IS NOT NULL;

UPDATE leak_rate_calcs
    SET calc_date = calculated_at::date
    WHERE calc_date IS NULL AND calculated_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- pressure_tests: add psi_reading, test_type, pass_fail, tested_at, created_at
--   007 has: test_pressure_psi, hold_time_min, passed, notes, tested_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pressure_tests
    ADD COLUMN IF NOT EXISTS psi_reading  numeric(7,2),
    ADD COLUMN IF NOT EXISTS test_type    text,
    ADD COLUMN IF NOT EXISTS pass_fail    bool,
    ADD COLUMN IF NOT EXISTS tested_at    timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now();

-- Backfill new columns from legacy equivalents.
UPDATE pressure_tests
    SET psi_reading = test_pressure_psi
    WHERE psi_reading IS NULL AND test_pressure_psi IS NOT NULL;

UPDATE pressure_tests
    SET pass_fail   = passed
    WHERE pass_fail IS NULL AND passed IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_refrigerant_logs_tenant
    ON refrigerant_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_leak_rate_calcs_tenant
    ON leak_rate_calcs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_pressure_tests_tenant
    ON pressure_tests(tenant_id);
