"""Stripe billing — subscription management and webhook handler."""
import os
import stripe
import sentry_sdk
from fastapi import APIRouter, Request, HTTPException, Header
from typing import Optional

from app.auth import get_current_user, get_supabase
from fastapi import Security

router = APIRouter()

stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")

# Price IDs from Stripe Dashboard (set in env)
PLAN_PRICES = {
    "starter":    os.getenv("STRIPE_PRICE_STARTER"),    # e.g. $49/mo
    "growth":     os.getenv("STRIPE_PRICE_GROWTH"),     # e.g. $149/mo
    "enterprise": os.getenv("STRIPE_PRICE_ENTERPRISE"), # e.g. $399/mo
}

PLAN_SEAT_LIMITS = {
    "starter":    2,
    "growth":     10,
    "enterprise": 9999,
}


@router.get("/billing/plans")
async def get_plans():
    """Return available plan metadata."""
    return {
        "plans": [
            {"id": "starter",    "name": "Starter",    "price_usd": 49,  "jobs_per_month": 50},
            {"id": "growth",     "name": "Growth",     "price_usd": 149, "jobs_per_month": 250},
            {"id": "enterprise", "name": "Enterprise", "price_usd": 399, "jobs_per_month": -1},
        ]
    }


@router.post("/billing/checkout")
async def create_checkout_session(
    plan: str,
    user: dict = Security(get_current_user),
):
    """Create a Stripe Checkout session for the given plan."""
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Billing not configured")
    price_id = PLAN_PRICES.get(plan)
    if not price_id:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {plan}")

    supabase = get_supabase()
    tenant = (
        supabase.table("tenants")
        .select("id, stripe_customer_id, name")
        .eq("id", user["tenant_id"])
        .single()
        .execute()
    )
    if not tenant.data:
        raise HTTPException(status_code=404, detail="Tenant not found")

    customer_id = tenant.data.get("stripe_customer_id")

    # Create Stripe customer if first time
    if not customer_id:
        customer = stripe.Customer.create(
            name=tenant.data["name"],
            metadata={"tenant_id": user["tenant_id"]},
        )
        customer_id = customer.id
        supabase.table("tenants").update(
            {"stripe_customer_id": customer_id}
        ).eq("id", user["tenant_id"]).execute()

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/billing/success",
        cancel_url=f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/billing",
        metadata={"tenant_id": user["tenant_id"], "plan": plan},
    )
    return {"checkout_url": session.url}


@router.post("/billing/portal")
async def create_billing_portal(user: dict = Security(get_current_user)):
    """Create a Stripe Customer Portal session for subscription management."""
    supabase = get_supabase()
    tenant = (
        supabase.table("tenants")
        .select("stripe_customer_id")
        .eq("id", user["tenant_id"])
        .single()
        .execute()
    )
    customer_id = tenant.data.get("stripe_customer_id") if tenant.data else None
    if not customer_id:
        raise HTTPException(status_code=404, detail="No billing account found")

    portal = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/billing",
    )
    return {"portal_url": portal.url}


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(None),
):
    """Handle Stripe webhook events — update tenant subscription status."""
    body = await request.body()

    if not WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Stripe webhook secret not configured")

    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    try:
        event = stripe.Webhook.construct_event(body, stripe_signature, WEBHOOK_SECRET)
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    supabase = get_supabase()

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        tenant_id = session["metadata"].get("tenant_id")
        plan = session["metadata"].get("plan", "starter")
        customer_id = session.get("customer")
        subscription_id = session.get("subscription")

        if tenant_id:
            supabase.table("tenants").update({
                "plan": plan,
                "stripe_customer_id": customer_id,
                "stripe_subscription_id": subscription_id,
                "subscription_status": "active",
                "seat_limit": PLAN_SEAT_LIMITS.get(plan, 2),
                "onboarding_complete": True,
            }).eq("id", tenant_id).execute()

    elif event["type"] == "customer.subscription.updated":
        sub = event["data"]["object"]
        sub_id = sub.get("id")
        if sub_id:
            price_id = (sub.get("items", {}).get("data") or [{}])[0].get("price", {}).get("id")
            plan = next((k for k, v in PLAN_PRICES.items() if v and v == price_id), "starter")
            supabase.table("tenants").update({
                "plan": plan,
                "subscription_status": sub.get("status", "active"),
                "seat_limit": PLAN_SEAT_LIMITS.get(plan, 2),
            }).eq("stripe_subscription_id", sub_id).execute()

    elif event["type"] == "customer.subscription.deleted":
        sub = event["data"]["object"]
        sub_id = sub.get("id")
        if sub_id:
            supabase.table("tenants").update({
                "plan": "cancelled",
                "subscription_status": "cancelled",
            }).eq("stripe_subscription_id", sub_id).execute()

    elif event["type"] == "invoice.payment_failed":
        invoice = event["data"]["object"]
        sub_id = invoice.get("subscription")
        sentry_sdk.capture_message(
            f"Stripe payment failed: subscription {sub_id}",
            level="warning",
        )
        if sub_id:
            supabase.table("tenants").update({
                "subscription_status": "past_due",
            }).eq("stripe_subscription_id", sub_id).execute()

    elif event["type"] == "invoice.paid":
        invoice = event["data"]["object"]
        sub_id = invoice.get("subscription")
        if sub_id:
            supabase.table("tenants").update({
                "subscription_status": "active",
            }).eq("stripe_subscription_id", sub_id).execute()

    return {"received": True}


@router.get("/billing/usage")
async def get_billing_usage(user: dict = Security(get_current_user)):
    """Return current month job usage and plan details for the billing page."""
    from app.core.plan_gate import get_usage
    supabase = get_supabase()
    return get_usage(supabase, user["tenant_id"])
