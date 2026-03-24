-- LeakLock Initial Schema — Run in order. Every table gets RLS before data goes in.

-- 1. Tenants (one per business)
CREATE TABLE tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  plan       text DEFAULT 'trial',
  created_at timestamptz DEFAULT now()
);

-- 2. Users
CREATE TABLE users (
  id         uuid PRIMARY KEY REFERENCES auth.users,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  role       text CHECK (role IN ('owner','auditor','tech')),
  full_name  text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_tenant ON users
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- 3. Clients
CREATE TABLE clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  address    text,
  crm_id     text  -- external CRM reference
);
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_tenant ON clients
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- 4. Jobs
CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  client_id    uuid REFERENCES clients(id),
  crm_job_id   text,  -- ID from Jobber/ServiceTitan
  status       text DEFAULT 'pending_invoice',
  match_status text DEFAULT 'unreviewed',
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_tenant ON jobs
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- 5. Estimates (Input A — The Promise)
CREATE TABLE estimates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  job_id      uuid REFERENCES jobs(id),
  line_items  jsonb NOT NULL,  -- [{desc, qty, unit_price}]
  total_cents bigint
);
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY estimates_tenant ON estimates
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- 6. Field Notes (Input B — The Reality)
CREATE TABLE field_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  job_id       uuid REFERENCES jobs(id),
  raw_text     text,      -- technician's free text
  photo_urls   text[],    -- Supabase Storage paths
  parsed_items jsonb,     -- AI output: [{item, qty, confidence}]
  parse_status text DEFAULT 'pending',
  parsed_at    timestamptz
);
ALTER TABLE field_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY field_notes_tenant ON field_notes
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- 7. Draft Invoices (Input C — The Bill)
CREATE TABLE draft_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  job_id          uuid REFERENCES jobs(id),
  line_items      jsonb NOT NULL,  -- [{desc, qty, unit_price}]
  total_cents     bigint,
  crm_invoice_id  text
);
ALTER TABLE draft_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY draft_invoices_tenant ON draft_invoices
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- 8. Reconciliation Results — IMMUTABLE, append-only
CREATE TABLE reconciliation_results (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  job_id                uuid REFERENCES jobs(id),
  run_at                timestamptz DEFAULT now(),
  status                text CHECK (status IN ('clean','discrepancy','error')),
  missing_items         jsonb,   -- items in B not in C
  extra_items           jsonb,   -- items in C not in A
  estimated_leak_cents  bigint,
  auditor_action        text,    -- 'approved','escalated','dismissed'
  auditor_id            uuid REFERENCES users(id),
  reviewed_at           timestamptz
);
ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY rr_tenant ON reconciliation_results
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
-- NO UPDATE policy — results are append-only
