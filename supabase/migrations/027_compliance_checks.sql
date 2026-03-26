-- compliance_checks — stores per-field-event compliance check results.
-- Written by _run_compliance_check() in tasks.py after each voice/text parse.

CREATE TABLE IF NOT EXISTS compliance_checks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_event_id    uuid NOT NULL REFERENCES field_events(id) ON DELETE CASCADE,
  schema_version    text NOT NULL DEFAULT '1.0.0',
  status            text NOT NULL CHECK (status IN ('pass','fail','warning')) DEFAULT 'pass',
  violations        jsonb NOT NULL DEFAULT '[]'::jsonb,
  score             integer NOT NULL DEFAULT 100 CHECK (score >= 0 AND score <= 100),
  checked_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_checks_tenant ON compliance_checks
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_compliance_checks_tenant ON compliance_checks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_event ON compliance_checks(field_event_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_status ON compliance_checks(status);
