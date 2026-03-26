-- Add profile columns to users table.
-- Required by: settings page (phone, notification_prefs),
--              team invite (email, status),
--              notification service (email, phone, notification_prefs).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email             text,
  ADD COLUMN IF NOT EXISTS phone             text,
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'active'
                                             CHECK (status IN ('active','invited','removed')),
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{
    "email_alerts": true,
    "sms_alerts": false,
    "slack_alerts": false,
    "alert_threshold_cents": 2500
  }'::jsonb;

-- Index for fast lookups by email (used by team invite dupe check)
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users(tenant_id, role);

-- Sync email from auth.users on insert (optional convenience trigger)
-- This keeps users.email in sync when a user is created via Supabase Auth.
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.users
  SET email = NEW.email
  WHERE id = NEW.id AND email IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_sync ON auth.users;
CREATE TRIGGER on_auth_user_email_sync
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_user_email();
