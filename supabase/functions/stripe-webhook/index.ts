/**
 * stripe-webhook Supabase Edge Function
 *
 * Verifies Stripe webhook signatures and handles 5 key billing events:
 *   1. checkout.session.completed   → activate tenant subscription
 *   2. customer.subscription.updated → update plan + seat limit
 *   3. customer.subscription.deleted → set read_only status + retention email
 *   4. invoice.payment_failed        → set payment_warning flag + email alert
 *   5. invoice.paid                  → clear payment_warning + PostHog log
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY         — Stripe secret key (sk_live_... or sk_test_...)
 *   STRIPE_WEBHOOK_SECRET     — Webhook signing secret (whsec_...)
 *   STRIPE_STARTER_PRICE_ID   — Price ID for Starter plan
 *   STRIPE_PRO_PRICE_ID       — Price ID for Pro plan
 *   STRIPE_ENTERPRISE_PRICE_ID — Price ID for Enterprise plan
 *   POSTHOG_API_KEY           — PostHog project API key
 *   POSTHOG_HOST              — PostHog host (default: https://app.posthog.com)
 *   SUPABASE_URL              (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import Stripe from 'npm:stripe@17';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Env vars ──────────────────────────────────────────────────────────────────

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const STRIPE_STARTER_PRICE_ID = Deno.env.get('STRIPE_STARTER_PRICE_ID') ?? '';
const STRIPE_PRO_PRICE_ID = Deno.env.get('STRIPE_PRO_PRICE_ID') ?? '';
const STRIPE_ENTERPRISE_PRICE_ID = Deno.env.get('STRIPE_ENTERPRISE_PRICE_ID') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const POSTHOG_API_KEY = Deno.env.get('POSTHOG_API_KEY') ?? '';
const POSTHOG_HOST = Deno.env.get('POSTHOG_HOST') ?? 'https://app.posthog.com';

// ── Price → plan mapping ──────────────────────────────────────────────────────

type Plan = 'starter' | 'pro' | 'enterprise';

const PRICE_TO_PLAN: Record<string, Plan> = {};
if (STRIPE_STARTER_PRICE_ID)    PRICE_TO_PLAN[STRIPE_STARTER_PRICE_ID]    = 'starter';
if (STRIPE_PRO_PRICE_ID)        PRICE_TO_PLAN[STRIPE_PRO_PRICE_ID]        = 'pro';
if (STRIPE_ENTERPRISE_PRICE_ID) PRICE_TO_PLAN[STRIPE_ENTERPRISE_PRICE_ID] = 'enterprise';

const PLAN_SEAT_LIMITS: Record<Plan, number> = {
  starter:    2,
  pro:        5,
  enterprise: 9999,   // unlimited — represented as 9999
};

// ── Clients ───────────────────────────────────────────────────────────────────

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  // Deno-compatible fetch
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── CORS headers ──────────────────────────────────────────────────────────────

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve plan name from a Stripe subscription object. */
function resolvePlanFromSub(sub: Stripe.Subscription): Plan {
  const priceId = (sub.items?.data ?? [])[0]?.price?.id ?? '';
  return PRICE_TO_PLAN[priceId] ?? 'starter';
}

/**
 * Call the send-notification edge function to alert the tenant owner.
 * We use a synthetic job_id of 'billing' since this is account-level.
 */
async function sendBillingNotification(
  tenantId: string,
  notificationType: 'payment_failed_billing' | 'subscription_cancelled',
  payload: Record<string, unknown>,
): Promise<void> {
  const notifUrl = `${SUPABASE_URL}/functions/v1/send-notification`;
  try {
    await fetch(notifUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        job_id: 'billing',
        notification_type: notificationType,
        payload,
      }),
    });
  } catch (err) {
    console.error('[stripe-webhook] send-notification call failed:', err);
  }
}

/** Capture a PostHog server-side event via HTTP API. */
async function capturePostHog(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  if (!POSTHOG_API_KEY) return;
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_API_KEY,
        event,
        distinct_id: distinctId,
        properties: {
          ...properties,
          $lib: 'supabase-edge-function',
        },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error('[stripe-webhook] PostHog capture failed:', err);
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) {
    console.warn('[stripe-webhook] checkout.session.completed: missing tenant_id in metadata');
    return;
  }

  const plan: Plan = (session.metadata?.plan as Plan) ?? 'starter';
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      status: 'active',
      subscription_status: 'active',
      seat_limit: PLAN_SEAT_LIMITS[plan],
      payment_warning: false,
      onboarding_complete: true,
    })
    .eq('id', tenantId);

  if (error) {
    console.error('[stripe-webhook] checkout.session.completed DB update failed:', error);
  } else {
    console.log(`[stripe-webhook] Tenant ${tenantId} activated on plan ${plan}`);
    await capturePostHog(tenantId, 'subscription_activated', { plan, subscription_id: subscriptionId });
  }
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const plan = resolvePlanFromSub(sub);
  const subId = sub.id;

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      plan,
      subscription_status: sub.status,
      seat_limit: PLAN_SEAT_LIMITS[plan],
    })
    .eq('stripe_subscription_id', subId);

  if (error) {
    console.error('[stripe-webhook] customer.subscription.updated DB update failed:', error);
  } else {
    console.log(`[stripe-webhook] Subscription ${subId} updated to plan ${plan}, status ${sub.status}`);
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const subId = sub.id;

  // Fetch the tenant so we can send the retention notification
  const { data: tenant, error: fetchErr } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('stripe_subscription_id', subId)
    .single();

  if (fetchErr || !tenant) {
    console.warn('[stripe-webhook] customer.subscription.deleted: tenant not found for sub', subId);
    return;
  }

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      status: 'read_only',
      subscription_status: 'cancelled',
      plan: 'cancelled',
    })
    .eq('stripe_subscription_id', subId);

  if (error) {
    console.error('[stripe-webhook] customer.subscription.deleted DB update failed:', error);
    return;
  }

  console.log(`[stripe-webhook] Tenant ${tenant.id} set to read_only (subscription cancelled)`);

  // Send retention email
  await sendBillingNotification(
    tenant.id,
    'subscription_cancelled',
    { subscription_id: subId },
  );

  await capturePostHog(tenant.id, 'subscription_cancelled', { subscription_id: subId });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
  if (!subId) {
    console.warn('[stripe-webhook] invoice.payment_failed: no subscription ID');
    return;
  }

  const { data: tenant, error: fetchErr } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('stripe_subscription_id', subId)
    .single();

  if (fetchErr || !tenant) {
    console.warn('[stripe-webhook] invoice.payment_failed: tenant not found for sub', subId);
    return;
  }

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      payment_warning: true,
      subscription_status: 'past_due',
    })
    .eq('stripe_subscription_id', subId);

  if (error) {
    console.error('[stripe-webhook] invoice.payment_failed DB update failed:', error);
    return;
  }

  console.log(`[stripe-webhook] Payment failed for tenant ${tenant.id}, sub ${subId}`);

  await sendBillingNotification(
    tenant.id,
    'payment_failed_billing',
    {
      subscription_id: subId,
      invoice_id: invoice.id,
      amount_due: invoice.amount_due,
    },
  );

  await capturePostHog(tenant.id, 'payment_failed', {
    subscription_id: subId,
    invoice_id: invoice.id,
    amount_due: invoice.amount_due,
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
  if (!subId) return;

  const { data: tenant, error: fetchErr } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('stripe_subscription_id', subId)
    .single();

  if (fetchErr || !tenant) {
    console.warn('[stripe-webhook] invoice.paid: tenant not found for sub', subId);
    return;
  }

  const { error } = await supabaseAdmin
    .from('tenants')
    .update({
      payment_warning: false,
      subscription_status: 'active',
    })
    .eq('stripe_subscription_id', subId);

  if (error) {
    console.error('[stripe-webhook] invoice.paid DB update failed:', error);
    return;
  }

  console.log(`[stripe-webhook] Invoice paid for tenant ${tenant.id}, sub ${subId}`);

  await capturePostHog(tenant.id, 'invoice_paid', {
    subscription_id: subId,
    invoice_id: invoice.id,
    amount_paid: invoice.amount_paid,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method Not Allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response(
      JSON.stringify({ error: 'Webhook secret not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response(
      JSON.stringify({ error: 'Missing Stripe-Signature header' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Read raw body — required for signature verification
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err);
    return new Response(
      JSON.stringify({ error: 'Invalid Stripe signature' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[stripe-webhook] Received event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe-webhook] Handler error for ${event.type}:`, err);
    // Return 200 to prevent Stripe from retrying — log is sufficient
  }

  return new Response(
    JSON.stringify({ received: true, event_type: event.type }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
