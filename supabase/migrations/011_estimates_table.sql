-- Estimates table: the original quoted price per job (Input A in 3-way match).
-- Referenced by tasks.py process_field_notes → run_three_way_match.

CREATE TABLE IF NOT EXISTS estimates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  line_items    jsonb NOT NULL DEFAULT '[]',
  -- Each element: { "description": str, "qty": number, "unit_price_cents": int }
  source        text NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual', 'jobber', 'housecall', 'servicetitan')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Required for ON CONFLICT upserts in webhook handler
CREATE UNIQUE INDEX IF NOT EXISTS idx_estimates_tenant_job ON estimates(tenant_id, job_id);
CREATE INDEX IF NOT EXISTS idx_estimates_tenant_id ON estimates(tenant_id);

-- RLS
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY estimates_tenant_isolation ON estimates
  USING (tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- Keep updated_at current
CREATE OR REPLACE FUNCTION touch_estimates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estimates_updated_at ON estimates;
CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION touch_estimates_updated_at();
