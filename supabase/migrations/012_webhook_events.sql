-- Durable webhook event store — written BEFORE processing, never deleted.
-- Enables replay and audit trail for all incoming webhooks.
CREATE TABLE IF NOT EXISTS webhook_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL DEFAULT 'jobber',
  event_type     text NOT NULL,
  idempotency_key text UNIQUE,          -- prevents duplicate processing
  raw_payload    jsonb NOT NULL,
  tenant_id      uuid REFERENCES tenants(id),
  status         text NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received','processing','complete','failed')),
  trigger_run_id text,                  -- Trigger.dev run ID for correlation
  error_message  text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
-- Service role only — no user-facing RLS needed for this audit table
CREATE POLICY webhook_events_service_only ON webhook_events
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_idempotency ON webhook_events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant ON webhook_events(tenant_id, received_at DESC);
