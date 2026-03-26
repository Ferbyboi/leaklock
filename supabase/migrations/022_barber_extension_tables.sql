-- Migration 022: Barber / Salon extension tables
-- Extends the base barber/salon tables created in 008_landscaping_barber_tables.sql
-- with additional columns required by the full niche specification.

-- ─────────────────────────────────────────────────────────────────────────────
-- sanitation_logs: add station_number, sanitizer_type, next_required_at,
--   sanitized_at (NOT NULL alias), created_at
--   008 has: location_id, field_event_id, tool_type, sanitization_method,
--             contact_time_sec, passed, logged_by, logged_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sanitation_logs
    ADD COLUMN IF NOT EXISTS station_number    text,
    ADD COLUMN IF NOT EXISTS sanitized_by      uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS sanitizer_type    text,
    ADD COLUMN IF NOT EXISTS sanitized_at      timestamptz,
    ADD COLUMN IF NOT EXISTS next_required_at  timestamptz,
    ADD COLUMN IF NOT EXISTS created_at        timestamptz NOT NULL DEFAULT now();

-- Backfill sanitized_at from legacy logged_at.
UPDATE sanitation_logs
    SET sanitized_at = logged_at
    WHERE sanitized_at IS NULL AND logged_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- client_formulas: add location_id, allergy_notes, last_used_at
--   008 has: client_name, service_type, formula_data, created_by,
--             created_at, updated_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE client_formulas
    ADD COLUMN IF NOT EXISTS location_id   uuid REFERENCES locations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS formula       jsonb,
    ADD COLUMN IF NOT EXISTS allergy_notes text,
    ADD COLUMN IF NOT EXISTS last_used_at  timestamptz;

-- Backfill formula from legacy formula_data.
UPDATE client_formulas
    SET formula = formula_data
    WHERE formula IS NULL AND formula_data IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- signed_waivers: add location_id, treatment_type, signature_url,
--   administered_by, waiver_text, created_at
--   008 has: client_name, service_type, chemical_service, signature_url,
--             signed_at, expires_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE signed_waivers
    ADD COLUMN IF NOT EXISTS location_id      uuid REFERENCES locations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS treatment_type   text,
    ADD COLUMN IF NOT EXISTS administered_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS waiver_text      text,
    ADD COLUMN IF NOT EXISTS created_at       timestamptz NOT NULL DEFAULT now();

-- Backfill treatment_type from legacy service_type.
UPDATE signed_waivers
    SET treatment_type = service_type
    WHERE treatment_type IS NULL AND service_type IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sanitation_logs_tenant
    ON sanitation_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_client_formulas_tenant
    ON client_formulas(tenant_id);

CREATE INDEX IF NOT EXISTS idx_signed_waivers_tenant
    ON signed_waivers(tenant_id);
