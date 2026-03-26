-- Add tenant_type to tenants (required for Schema Router)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tenant_type text CHECK (tenant_type IN ('restaurant','hvac','plumbing','tree_service','landscaping','barber','salon')),
  ADD COLUMN IF NOT EXISTS seat_limit integer DEFAULT 2,
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;

-- Locations
CREATE TABLE IF NOT EXISTS locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text,
  city        text,
  state       text,
  zip         text,
  lat         numeric(9,6),
  lng         numeric(9,6),
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_tenant ON locations USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations(tenant_id);

-- Assets
CREATE TABLE IF NOT EXISTS assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id  uuid REFERENCES locations(id),
  name         text NOT NULL,
  asset_type   text,
  serial_number text,
  install_date date,
  metadata     jsonb DEFAULT '{}',
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY assets_tenant ON assets USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assets_location ON assets(location_id);

-- Field events (voice + photo captures)
CREATE TABLE IF NOT EXISTS field_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id          uuid REFERENCES jobs(id),
  location_id     uuid REFERENCES locations(id),
  user_id         uuid REFERENCES users(id),
  event_type      text NOT NULL CHECK (event_type IN ('voice','photo','text','checklist')),
  raw_storage_url text,
  transcript      text,
  transcript_confidence numeric(4,3),
  parsed_data     jsonb,
  compliance_status text CHECK (compliance_status IN ('pass','warning','fail','pending')),
  niche_type      text,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE field_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY field_events_tenant ON field_events USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_field_events_tenant ON field_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_field_events_job ON field_events(job_id);
CREATE INDEX IF NOT EXISTS idx_field_events_location ON field_events(location_id);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id  uuid REFERENCES locations(id),
  job_id       uuid REFERENCES jobs(id),
  field_event_id uuid REFERENCES field_events(id),
  severity     text NOT NULL CHECK (severity IN ('critical','warning','info')),
  alert_type   text NOT NULL,
  title        text NOT NULL,
  body         text,
  metadata     jsonb DEFAULT '{}',
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id),
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY alerts_tenant ON alerts USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_alerts_tenant_unread ON alerts(tenant_id, created_at DESC) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_location ON alerts(location_id);

-- Notifications audit log
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alert_id     uuid REFERENCES alerts(id),
  channel      text NOT NULL CHECK (channel IN ('sms','email','slack','push','in_app')),
  recipient    text NOT NULL,
  status       text DEFAULT 'sent' CHECK (status IN ('sent','failed','rate_limited')),
  sent_at      timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant ON notifications USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id, sent_at DESC);
