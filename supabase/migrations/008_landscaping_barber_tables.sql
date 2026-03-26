-- Landscaping tables
CREATE TABLE IF NOT EXISTS chemical_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id),
  field_event_id uuid REFERENCES field_events(id),
  chemical_name text NOT NULL,
  epa_reg_number text,
  application_rate text,
  target_area text,
  wind_speed_mph numeric(4,1),
  buffer_zone_ft numeric(6,1),
  compliance_status text CHECK (compliance_status IN ('pass','warning','fail','pending')),
  applied_by uuid REFERENCES users(id),
  applied_at timestamptz DEFAULT now()
);
ALTER TABLE chemical_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY chemical_applications_tenant ON chemical_applications USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS irrigation_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id),
  asset_id uuid REFERENCES assets(id),
  zone_id text,
  flow_gpm numeric(6,2),
  runtime_min integer,
  soil_moisture_pct numeric(5,1),
  notes text,
  read_at timestamptz DEFAULT now()
);
ALTER TABLE irrigation_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY irrigation_readings_tenant ON irrigation_readings USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS plant_health_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id),
  field_event_id uuid REFERENCES field_events(id),
  plant_id text,
  health_score integer CHECK (health_score BETWEEN 1 AND 10),
  issues_detected jsonb DEFAULT '[]',
  photo_url text,
  assessed_at timestamptz DEFAULT now()
);
ALTER TABLE plant_health_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY plant_health_photos_tenant ON plant_health_photos USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- Barber / Salon tables
CREATE TABLE IF NOT EXISTS sanitation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id),
  field_event_id uuid REFERENCES field_events(id),
  tool_type text NOT NULL,
  sanitization_method text NOT NULL,
  contact_time_sec integer NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  logged_by uuid REFERENCES users(id),
  logged_at timestamptz DEFAULT now()
);
ALTER TABLE sanitation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sanitation_logs_tenant ON sanitation_logs USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS client_formulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  service_type text NOT NULL,
  formula_data jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE client_formulas ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_formulas_tenant ON client_formulas USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS signed_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  service_type text NOT NULL,
  chemical_service boolean NOT NULL DEFAULT false,
  signature_url text,
  signed_at timestamptz DEFAULT now(),
  expires_at timestamptz
);
ALTER TABLE signed_waivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY signed_waivers_tenant ON signed_waivers USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_chemical_applications_tenant ON chemical_applications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_readings_tenant ON irrigation_readings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plant_health_photos_tenant ON plant_health_photos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sanitation_logs_tenant ON sanitation_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_formulas_tenant ON client_formulas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_signed_waivers_tenant ON signed_waivers(tenant_id);
