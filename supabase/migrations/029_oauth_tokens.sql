-- oauth_tokens — stores OAuth2 access/refresh tokens for CRM integrations.
-- Used by connectors to make authenticated API calls on behalf of tenants.

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('toast','square','servicetitan','housecallpro','jobber','quickbooks')),
  access_token    text NOT NULL,
  refresh_token   text,
  token_type      text NOT NULL DEFAULT 'Bearer',
  expires_at      timestamptz,
  scopes          text[],
  merchant_id     text,  -- provider's account/merchant identifier
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_tokens_tenant ON oauth_tokens
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_tenant ON oauth_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider ON oauth_tokens(provider);
