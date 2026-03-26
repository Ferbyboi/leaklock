CREATE TABLE IF NOT EXISTS temperature_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_event_id uuid REFERENCES field_events(id), location_id uuid REFERENCES locations(id),
  asset_id uuid REFERENCES assets(id), item text NOT NULL, temp_f numeric(5,1) NOT NULL,
  zone_status text NOT NULL CHECK (zone_status IN ('safe','danger')), logged_at timestamptz DEFAULT now()
);
ALTER TABLE temperature_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY temp_logs_tenant ON temperature_logs USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS grease_trap_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id), field_event_id uuid REFERENCES field_events(id),
  fill_pct numeric(5,2) NOT NULL CHECK (fill_pct BETWEEN 0 AND 100),
  photo_url text, next_service date, notes text, inspected_at timestamptz DEFAULT now()
);
ALTER TABLE grease_trap_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY grease_trap_tenant ON grease_trap_inspections USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS hood_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id), field_event_id uuid REFERENCES field_events(id),
  cleanliness_score integer CHECK (cleanliness_score BETWEEN 1 AND 10),
  grease_zones jsonb DEFAULT '[]', photo_url text, inspected_at timestamptz DEFAULT now()
);
ALTER TABLE hood_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY hood_inspections_tenant ON hood_inspections USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS daily_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id), date date NOT NULL DEFAULT CURRENT_DATE,
  checks_completed jsonb NOT NULL DEFAULT '{}', score numeric(5,2) CHECK (score BETWEEN 0 AND 100),
  completed_by uuid REFERENCES users(id), created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, location_id, date)
);
ALTER TABLE daily_health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_health_checks_tenant ON daily_health_checks USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
