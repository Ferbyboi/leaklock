-- Add per-user in-app notification columns to alerts table.
-- The notification_service._send_inapp() inserts recipient_id and read;
-- severity and alert_type need defaults so in-app inserts don't require them.

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS recipient_id  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS read          boolean DEFAULT false,
  ALTER COLUMN severity   SET DEFAULT 'info',
  ALTER COLUMN alert_type SET DEFAULT 'in_app';

CREATE INDEX IF NOT EXISTS idx_alerts_recipient_unread
  ON alerts(tenant_id, recipient_id, created_at DESC)
  WHERE read = false;
