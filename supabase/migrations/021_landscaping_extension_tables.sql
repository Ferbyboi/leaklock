-- Migration 021: Landscaping extension tables
-- Extends the base landscaping tables created in 008_landscaping_barber_tables.sql
-- with additional columns required by the full niche specification.

-- ─────────────────────────────────────────────────────────────────────────────
-- chemical_applications: add product (NOT NULL), qty, unit, dilution_ratio,
--   application_method, zone, weather, applied_at, created_at
--   008 has: location_id, field_event_id, chemical_name, epa_reg_number,
--             application_rate, target_area, wind_speed_mph, buffer_zone_ft,
--             compliance_status, applied_by, applied_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE chemical_applications
    ADD COLUMN IF NOT EXISTS product             text,
    ADD COLUMN IF NOT EXISTS qty                 numeric(10,3),
    ADD COLUMN IF NOT EXISTS unit                text,
    ADD COLUMN IF NOT EXISTS dilution_ratio      text,
    ADD COLUMN IF NOT EXISTS application_method  text,
    ADD COLUMN IF NOT EXISTS zone                text,
    ADD COLUMN IF NOT EXISTS weather             jsonb NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS created_at          timestamptz NOT NULL DEFAULT now();

-- Backfill product from legacy chemical_name where not yet set.
UPDATE chemical_applications
    SET product = chemical_name
    WHERE product IS NULL AND chemical_name IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- irrigation_readings: add pressure_psi, flow_rate_gpm, anomaly_detected,
--   anomaly_type, recorded_at, created_at
--   008 has: location_id, asset_id, zone_id, flow_gpm, runtime_min,
--             soil_moisture_pct, notes, read_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE irrigation_readings
    ADD COLUMN IF NOT EXISTS zone              text,
    ADD COLUMN IF NOT EXISTS pressure_psi      numeric(7,2),
    ADD COLUMN IF NOT EXISTS flow_rate_gpm     numeric(7,2),
    ADD COLUMN IF NOT EXISTS anomaly_detected  bool NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS anomaly_type      text,
    ADD COLUMN IF NOT EXISTS recorded_at       timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_at        timestamptz NOT NULL DEFAULT now();

-- Backfill flow_rate_gpm from legacy flow_gpm.
UPDATE irrigation_readings
    SET flow_rate_gpm = flow_gpm
    WHERE flow_rate_gpm IS NULL AND flow_gpm IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- plant_health_photos: add diagnosis, treatment_plan, severity,
--   ai_confidence, analyzed_at, created_at
--   008 has: location_id, field_event_id, plant_id, health_score,
--             issues_detected, photo_url, assessed_at
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE plant_health_photos
    ADD COLUMN IF NOT EXISTS diagnosis       text,
    ADD COLUMN IF NOT EXISTS treatment_plan  text,
    ADD COLUMN IF NOT EXISTS severity        text,
    ADD COLUMN IF NOT EXISTS ai_confidence   numeric(4,3),
    ADD COLUMN IF NOT EXISTS analyzed_at     timestamptz,
    ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now();

ALTER TABLE plant_health_photos
    ADD CONSTRAINT plant_health_photos_severity_check
    CHECK (severity IS NULL OR
           severity IN ('healthy', 'mild', 'moderate', 'severe'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_chemical_applications_tenant
    ON chemical_applications(tenant_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_readings_tenant
    ON irrigation_readings(tenant_id);

CREATE INDEX IF NOT EXISTS idx_plant_health_photos_tenant
    ON plant_health_photos(tenant_id);
