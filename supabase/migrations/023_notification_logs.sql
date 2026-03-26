-- Migration 023: notification_logs
-- Central audit trail for every outbound notification (email, SMS, Slack, push).
-- Used to track delivery status, de-duplicate retries, and feed PostHog
-- false-positive rate dashboards.

CREATE TABLE IF NOT EXISTS notification_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id      uuid        REFERENCES jobs(id) ON DELETE SET NULL,
  channel     text        NOT NULL CHECK (channel IN ('email', 'sms', 'slack', 'push')),
  status      text        NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  sent_at     timestamptz,
  error_msg   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_logs_tenant ON notification_logs
    USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_notification_logs_tenant
    ON notification_logs(tenant_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_job_id
    ON notification_logs(job_id);

CREATE INDEX IF NOT EXISTS idx_notification_logs_status
    ON notification_logs(status);
