/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session in embedded mode.
 *
 * Request body: { plan: 'starter' | 'pro' | 'enterprise', tenant_id?: string }
 * Response:     { client_secret: string } (for embedded checkout)
 *               or { checkout_url: string } if hosted mode fallback
 *
 * The server reads STRIPE_SECRET_KEY and STRIPE_*_PRICE_ID from env vars
 * so that they are never exposed to the browser.
 */

import { NextResponse, type NextRequest } from 'next/server';
import Stripe from 'stripe';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// ── Stripe client (server-side only, lazy to avoid build-time errors) ────────

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// ── Price ID mapping from env vars ────────────────────────────────────────────

type Plan = 'starter' | 'pro' | 'enterprise';

const PLAN_PRICE_IDS: Record<Plan, string | undefined> = {
  starter:    process.env.STRIPE_STARTER_PRICE_ID,
  pro:        process.env.STRIPE_PRO_PRICE_ID,
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID,
};

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── 1. Authenticate the caller ─────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Shim so the rest of the handler can use session.user unchanged
  const session = { user };

  // ── 2. Parse and validate request body ─────────────────────────────────────
  let body: { plan?: string; tenant_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const plan = (body.plan ?? '') as Plan;
  if (!['starter', 'pro', 'enterprise'].includes(plan)) {
    return NextResponse.json(
      { error: `Invalid plan: ${plan}. Must be starter, pro, or enterprise.` },
      { status: 400 },
    );
  }

  const priceId = PLAN_PRICE_IDS[plan];
  if (!priceId) {
    return NextResponse.json(
      { error: `Price ID not configured for plan: ${plan}` },
      { status: 503 },
    );
  }

  // ── 3. Resolve tenant and Stripe customer ──────────────────────────────────
  const tenantId =
    body.tenant_id ??
    (session.user.app_metadata?.tenant_id as string | undefined) ??
    (session.user.user_metadata?.tenant_id as string | undefined);

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, stripe_customer_id')
    .eq('id', tenantId)
    .single();

  if (tenantErr || !tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  let customerId: string = tenant.stripe_customer_id ?? '';

  const stripe = getStripe();

  // Create a Stripe Customer on first checkout
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email,
      name: tenant.name ?? undefined,
      metadata: { tenant_id: tenantId },
    });
    customerId = customer.id;

    // Persist the new customer ID — best-effort, don't fail checkout if this fails
    await supabase
      .from('tenants')
      .update({ stripe_customer_id: customerId })
      .eq('id', tenantId);
  }

  // ── 4. Create Stripe Checkout Session (hosted mode) ──────────────────────
  const frontendUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';

  let checkoutSession: Stripe.Checkout.Session;
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/billing`,
      customer_email: !customerId ? session.user.email : undefined,
      metadata: {
        tenant_id: tenantId,
        plan,
      },
    });
  } catch (err) {
    const stripeMsg = err instanceof Error ? err.message : String(err);
    console.error('[billing/checkout] Stripe session creation failed:', stripeMsg);
    return NextResponse.json(
      { error: `Failed to create checkout session: ${stripeMsg}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: checkoutSession.url });
}
