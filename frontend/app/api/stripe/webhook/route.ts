/**
 * POST /api/stripe/webhook
 *
 * Receives and verifies Stripe webhook events, then updates the tenants table
 * in Supabase via the service-role client (server-to-server — no user session).
 *
 * Events handled:
 *   checkout.session.completed       — activate plan after successful payment
 *   customer.subscription.updated    — sync plan changes / status changes
 *   customer.subscription.deleted    — cancel plan
 *   invoice.payment_failed           — log + report to Sentry (no downgrade yet)
 */

import { headers } from 'next/headers';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';

// ── Clients (lazy — avoid build-time errors when env vars are absent) ─────────

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? '');
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Price → Plan mapping ───────────────────────────────────────────────────────

type LeakLockPlan = 'starter' | 'pro' | 'enterprise' | 'cancelled';

function priceIdToPlan(priceId: string): LeakLockPlan | null {
  if (priceId === process.env.STRIPE_STARTER_PRICE_ID)    return 'starter';
  if (priceId === process.env.STRIPE_PRO_PRICE_ID)        return 'pro';
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return 'enterprise';
  return null;
}

// ── Helper: resolve tenant_id from a subscription object ─────────────────────
//
// Prefer subscription.metadata.tenant_id (set at subscription creation) but
// fall back to querying tenants by stripe_customer_id if metadata is absent.

async function resolveTenantId(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const metaTenantId = subscription.metadata?.tenant_id;
  if (metaTenantId) return metaTenantId;

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  const { data, error } = await getSupabase()
    .from('tenants')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (error || !data) {
    console.error('[stripe/webhook] Could not resolve tenant for customer', customerId, error);
    return null;
  }

  return data.id as string;
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Read raw body — required for Stripe signature verification.
  const body = await req.text();
  const headersList = await headers();
  const sig = headersList.get('stripe-signature');

  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const stripe = getStripe();
  const supabase = getSupabase();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

  // 2. Verify webhook signature.
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err);
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  // 3. Dispatch on event type.
  switch (event.type) {
    // ── checkout.session.completed ─────────────────────────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenant_id;
      const plan = session.metadata?.plan as LeakLockPlan | undefined;
      const subscriptionId = session.subscription as string | null;

      if (tenantId && plan) {
        const { error } = await supabase
          .from('tenants')
          .update({
            plan,
            stripe_subscription_id: subscriptionId ?? null,
            stripe_customer_id: session.customer as string,
          })
          .eq('id', tenantId);

        if (error) {
          console.error('[stripe/webhook] checkout.session.completed update failed:', error);
        }
      }
      break;
    }

    // ── customer.subscription.updated ─────────────────────────────────────
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const tenantId = await resolveTenantId(subscription);

      if (!tenantId) break;

      let newPlan: LeakLockPlan;

      if (subscription.status === 'canceled') {
        newPlan = 'cancelled';
      } else if (
        subscription.status === 'past_due' ||
        subscription.status === 'unpaid'
      ) {
        // Downgrade to starter but do not cancel — Stripe will retry billing.
        newPlan = 'starter';
      } else {
        // Derive plan from the active price ID.
        const priceId = subscription.items.data[0]?.price?.id;
        const mapped = priceId ? priceIdToPlan(priceId) : null;

        if (!mapped) {
          console.warn(
            '[stripe/webhook] customer.subscription.updated: unknown price ID',
            priceId,
          );
          break;
        }

        newPlan = mapped;
      }

      const { error } = await supabase
        .from('tenants')
        .update({ plan: newPlan })
        .eq('id', tenantId);

      if (error) {
        console.error('[stripe/webhook] customer.subscription.updated plan update failed:', error);
      }
      break;
    }

    // ── customer.subscription.deleted ─────────────────────────────────────
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;

      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

      const { error } = await supabase
        .from('tenants')
        .update({
          plan: 'cancelled',
          stripe_subscription_id: null,
        })
        .eq('stripe_customer_id', customerId);

      if (error) {
        console.error('[stripe/webhook] customer.subscription.deleted update failed:', error);
      }
      break;
    }

    // ── invoice.payment_failed ─────────────────────────────────────────────
    //
    // Do NOT downgrade here — Stripe retries the charge automatically.
    // Only downgrade after subscription.deleted fires (exhausted retries).
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;

      const customerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : (invoice.customer as Stripe.Customer | null)?.id ?? 'unknown';

      const message = `[stripe/webhook] invoice.payment_failed for customer ${customerId}, invoice ${invoice.id}`;
      console.error(message);

      Sentry.captureEvent({
        message,
        level: 'warning',
        extra: {
          stripe_customer_id: customerId,
          invoice_id: invoice.id,
          amount_due: invoice.amount_due,
          attempt_count: invoice.attempt_count,
        },
      });
      break;
    }

    // ── Unhandled events ───────────────────────────────────────────────────
    default:
      console.log('Unhandled Stripe event:', event.type);
  }

  // Always return 200 for handled events so Stripe does not retry.
  return new Response('ok', { status: 200 });
}
