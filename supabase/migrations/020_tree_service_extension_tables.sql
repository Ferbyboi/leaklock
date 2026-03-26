-- Migration 020: Tree Service extension tables
-- Extends the base tree service tables created in 007_hvac_tree_tables.sql
-- with additional columns required by the full niche specification.

-- ─────────────────────────────────────────────────────────────────────────────
-- safety_checklists: add explicit bool columns + power_line_proximity_ft +
--   overall_score + completed_at + created_at
--   007 has: ppe_items jsonb, power_line_distance_ft, hazard_assessment,
--             compliance_status, completed_by, completed_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE safety_checklists
    ADD COLUMN IF NOT EXISTS power_line_clear         bool,
    ADD COLUMN IF NOT EXISTS ppe_confirmed            bool,
    ADD COLUMN IF NOT EXISTS ground_zone_cleared      bool,
    ADD COLUMN IF NOT EXISTS power_line_proximity_ft  numeric(6,1),
    ADD COLUMN IF NOT EXISTS overall_score            integer,
    ADD COLUMN IF NOT EXISTS created_at               timestamptz NOT NULL DEFAULT now();

ALTER TABLE safety_checklists
    ADD CONSTRAINT safety_checklists_overall_score_check
    CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100));

-- ─────────────────────────────────────────────────────────────────────────────
-- tree_assets: add health_status CHECK, lat/lng, last_inspected_at, created_at
--   007 has: species, dbh_inches, height_ft, condition_rating, last_serviced,
--             notes, created_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tree_assets
    ADD COLUMN IF NOT EXISTS health_status       text,
    ADD COLUMN IF NOT EXISTS lat                 numeric(10,7),
    ADD COLUMN IF NOT EXISTS lng                 numeric(10,7),
    ADD COLUMN IF NOT EXISTS last_inspected_at   timestamptz;

ALTER TABLE tree_assets
    ADD CONSTRAINT tree_assets_health_status_check
    CHECK (health_status IS NULL OR
           health_status IN ('excellent', 'good', 'fair', 'poor', 'critical'));

-- ─────────────────────────────────────────────────────────────────────────────
-- equipment_logs: add equipment_type, equipment_name, maintenance_type,
--   maintenance_notes, next_service_date, logged_at, created_at
--   007 has: asset_id, field_event_id, inspection_type, passed, defects,
--             serviced_by, logged_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE equipment_logs
    ADD COLUMN IF NOT EXISTS user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS equipment_type       text,
    ADD COLUMN IF NOT EXISTS equipment_name       text,
    ADD COLUMN IF NOT EXISTS maintenance_type     text,
    ADD COLUMN IF NOT EXISTS maintenance_notes    text,
    ADD COLUMN IF NOT EXISTS next_service_date    date,
    ADD COLUMN IF NOT EXISTS created_at           timestamptz NOT NULL DEFAULT now();

ALTER TABLE equipment_logs
    ADD CONSTRAINT equipment_logs_maintenance_type_check
    CHECK (maintenance_type IS NULL OR
           maintenance_type IN ('routine', 'repair', 'inspection', 'replacement'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_safety_checklists_tenant
    ON safety_checklists(tenant_id);

CREATE INDEX IF NOT EXISTS idx_tree_assets_tenant
    ON tree_assets(tenant_id);

CREATE INDEX IF NOT EXISTS idx_equipment_logs_tenant
    ON equipment_logs(tenant_id);
