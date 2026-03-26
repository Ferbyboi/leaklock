-- HVAC / Plumbing tables
CREATE TABLE IF NOT EXISTS refrigerant_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id),
  asset_id uuid REFERENCES assets(id),
  field_event_id uuid REFERENCES field_events(id),
  refrigerant_type text NOT NULL,
  amount_lbs numeric(8,3) NOT NULL CHECK (amount_lbs >= 0),
  action text NOT NULL CHECK (action IN ('added','recovered','leak_check')),
  leak_rate_pct numeric(5,2),
  technician_cert text,
  logged_at timestamptz DEFAULT now()
);
ALTER TABLE refrigerant_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY refrigerant_logs_tenant ON refrigerant_logs USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS leak_rate_calcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES assets(id),
  field_event_id uuid REFERENCES field_events(id),
  leak_rate_pct numeric(5,2) NOT NULL,
  threshold_pct numeric(5,2) NOT NULL,
  compliance_status text NOT NULL CHECK (compliance_status IN ('pass','warning','fail')),
  calculated_at timestamptz DEFAULT now()
);
ALTER TABLE leak_rate_calcs ENABLE ROW LEVEL SECURITY;
CREATE POLICY leak_rate_calcs_tenant ON leak_rate_calcs USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS pressure_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES assets(id),
  field_event_id uuid REFERENCES field_events(id),
  test_pressure_psi numeric(8,2) NOT NULL,
  hold_time_min integer,
  passed boolean NOT NULL DEFAULT false,
  notes text,
  tested_at timestamptz DEFAULT now()
);
ALTER TABLE pressure_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY pressure_tests_tenant ON pressure_tests USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- Tree Service tables
CREATE TABLE IF NOT EXISTS safety_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id),
  field_event_id uuid REFERENCES field_events(id),
  ppe_items jsonb NOT NULL DEFAULT '{}',
  power_line_distance_ft numeric(6,1),
  hazard_assessment text,
  compliance_status text CHECK (compliance_status IN ('pass','warning','fail','pending')),
  completed_by uuid REFERENCES users(id),
  completed_at timestamptz DEFAULT now()
);
ALTER TABLE safety_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY safety_checklists_tenant ON safety_checklists USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS tree_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES locations(id),
  species text,
  dbh_inches numeric(5,1),
  height_ft numeric(5,1),
  condition_rating integer CHECK (condition_rating BETWEEN 1 AND 5),
  last_serviced date,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE tree_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tree_assets_tenant ON tree_assets USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS equipment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES assets(id),
  field_event_id uuid REFERENCES field_events(id),
  inspection_type text NOT NULL,
  passed boolean NOT NULL DEFAULT true,
  defects jsonb DEFAULT '[]',
  serviced_by uuid REFERENCES users(id),
  logged_at timestamptz DEFAULT now()
);
ALTER TABLE equipment_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipment_logs_tenant ON equipment_logs USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_refrigerant_logs_tenant ON refrigerant_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leak_rate_calcs_tenant ON leak_rate_calcs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pressure_tests_tenant ON pressure_tests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_safety_checklists_tenant ON safety_checklists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tree_assets_tenant ON tree_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_equipment_logs_tenant ON equipment_logs(tenant_id);
