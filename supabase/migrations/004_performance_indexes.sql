-- Performance indexes for common query patterns

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id ON jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON jobs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_field_notes_job_id ON field_notes(job_id);
CREATE INDEX IF NOT EXISTS idx_field_notes_tenant_id ON field_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_draft_invoices_job_id ON draft_invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_job_tenant ON reconciliation_results(job_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_results_unreviewed ON reconciliation_results(tenant_id, status) WHERE auditor_action IS NULL;
CREATE INDEX IF NOT EXISTS idx_estimates_job_id ON estimates(job_id);
