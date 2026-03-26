-- Migration 026: API keys table for Enterprise tenant API access
-- Supports /settings/api page and programmatic webhook integration.

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  key_prefix    text NOT NULL,          -- First 12 chars of key, shown in UI
  key_hash      text NOT NULL,          -- SHA-256 hash of full key, for verification
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,            -- NULL = active, non-NULL = revoked
  created_by    uuid REFERENCES auth.users(id)
);

-- Index for tenant lookups (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys (tenant_id);

-- Partial index: active keys only (revoked keys excluded)
CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON api_keys (tenant_id, created_at)
  WHERE revoked_at IS NULL;

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Tenants can only see their own keys
CREATE POLICY "api_keys_select_own_tenant"
  ON api_keys FOR SELECT
  USING (tenant_id = (
    SELECT tenant_id FROM users WHERE id = auth.uid()
  ));

-- Only owners can insert keys
CREATE POLICY "api_keys_insert_owner"
  ON api_keys FOR INSERT
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (SELECT role FROM users WHERE id = auth.uid()) = 'owner'
  );

-- Only owners can update (revoke) keys — only allows setting revoked_at
CREATE POLICY "api_keys_update_owner"
  ON api_keys FOR UPDATE
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (SELECT role FROM users WHERE id = auth.uid()) = 'owner'
  );

-- Only owners can delete keys
CREATE POLICY "api_keys_delete_owner"
  ON api_keys FOR DELETE
  USING (
    tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    AND (SELECT role FROM users WHERE id = auth.uid()) = 'owner'
  );

COMMENT ON TABLE api_keys IS
  'API keys for Enterprise tenants. Full key is never stored — only a SHA-256 hash '
  'for verification and a 12-char prefix for display. Keys are created via /settings/api.';

COMMENT ON COLUMN api_keys.key_prefix IS
  'First 12 characters of the generated key (e.g. sk_live_a1b2c). '
  'Shown in the UI so users can identify which key is which.';

COMMENT ON COLUMN api_keys.key_hash IS
  'SHA-256 hex digest of the full key. Used to verify API requests. '
  'The full key is only shown once at creation and never stored.';
