-- 014: Append-only audit log for destructive operations
-- Per CLAUDE.md: "Audit log is append-only — no UPDATE, no DELETE"

CREATE TABLE IF NOT EXISTS audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    actor_id    uuid NOT NULL,
    action      text NOT NULL,  -- e.g. 'job.approved', 'member.removed', 'alert.acknowledged'
    entity_type text NOT NULL,  -- e.g. 'job', 'user', 'reconciliation_result'
    entity_id   uuid,
    metadata    jsonb DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_actor  ON audit_log(actor_id, created_at DESC);

-- RLS: tenant isolation
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_tenant_isolation"
    ON audit_log
    FOR ALL
    USING (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

-- CRITICAL: No UPDATE or DELETE policies — audit log is truly append-only
-- Only INSERT is allowed through the application layer
CREATE POLICY "audit_log_insert_only"
    ON audit_log
    FOR INSERT
    WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id')::uuid);

-- Prevent any updates or deletes via trigger (defense in depth)
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only — UPDATE and DELETE are prohibited';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_mutation();
