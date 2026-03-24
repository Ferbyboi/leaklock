-- Add Stripe billing columns to tenants table
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status    TEXT    NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS plan                   TEXT    NOT NULL DEFAULT 'starter';

-- Index for fast webhook lookups by Stripe customer ID
CREATE INDEX IF NOT EXISTS tenants_stripe_customer_id_idx
  ON tenants (stripe_customer_id);

COMMENT ON COLUMN tenants.subscription_status IS
  'Mirrors Stripe subscription status: trialing | active | past_due | canceled | unpaid';
COMMENT ON COLUMN tenants.plan IS
  'Current plan tier: starter | growth | enterprise';
