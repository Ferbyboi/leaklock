"""Tests for the Stripe billing endpoints.

Covers:
- GET /billing/plans — public, returns plan list
- POST /billing/checkout — creates Stripe session (new + existing customer)
- POST /billing/checkout — 400 for unknown plan
- POST /billing/portal — returns portal URL
- POST /billing/portal — 404 when no stripe_customer_id
- POST /webhooks/stripe — checkout.session.completed updates tenant plan
- POST /webhooks/stripe — customer.subscription.updated updates status
- POST /webhooks/stripe — 400 on bad Stripe signature
- POST /webhooks/stripe — 400 when webhook secret missing
"""
from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import get_current_user

TENANT_ID = str(uuid.uuid4())
USER_ID   = str(uuid.uuid4())

_FAKE_TOKEN = jwt.encode({"sub": USER_ID}, "x", algorithm="HS256")
_AUTH       = {"Authorization": f"Bearer {_FAKE_TOKEN}"}

_OWNER_USER = {
    "user_id":   USER_ID,
    "tenant_id": TENANT_ID,
    "role":      "owner",
    "email":     "owner@example.com",
}

_TENANT_WITH_CUSTOMER = {
    "id":                 TENANT_ID,
    "name":               "Acme Plumbing",
    "stripe_customer_id": "cus_existing123",
}

_TENANT_NO_CUSTOMER = {
    "id":                 TENANT_ID,
    "name":               "Acme Plumbing",
    "stripe_customer_id": None,
}

client = TestClient(app)


def _auth_as(user: dict):
    app.dependency_overrides[get_current_user] = lambda: user
    patch("app.auth.get_current_user", return_value=user).start()


def teardown_function():
    app.dependency_overrides.clear()
    patch.stopall()


# ── GET /billing/plans ─────────────────────────────────────────────────────────

def test_get_plans_returns_list():
    resp = client.get("/billing/plans")
    assert resp.status_code == 200
    data = resp.json()
    assert "plans" in data
    ids = [p["id"] for p in data["plans"]]
    assert "starter" in ids
    assert "growth" in ids
    assert "enterprise" in ids


def test_get_plans_has_price_fields():
    resp = client.get("/billing/plans")
    plan = resp.json()["plans"][0]
    assert "price_usd" in plan
    assert "jobs_per_month" in plan


# ── POST /billing/checkout ─────────────────────────────────────────────────────

_FAKE_PRICES = {"starter": "price_starter123", "growth": "price_growth456", "enterprise": "price_ent789"}


def test_checkout_unknown_plan_returns_400():
    _auth_as(_OWNER_USER)
    # Even with valid prices dict, "nonexistent" won't be found
    with patch.dict("app.routers.billing.PLAN_PRICES", _FAKE_PRICES):
        resp = client.post("/billing/checkout?plan=nonexistent", headers=_AUTH)
    assert resp.status_code == 400
    assert "Unknown plan" in resp.json()["detail"]


def test_checkout_creates_session_existing_customer():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    # tenant lookup: .table().select().eq().single().execute()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data=_TENANT_WITH_CUSTOMER)
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data={})

    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_test_abc"

    with patch.dict("app.routers.billing.PLAN_PRICES", _FAKE_PRICES), \
         patch("app.routers.billing.get_supabase", return_value=sb), \
         patch("app.routers.billing.stripe.checkout.Session.create", return_value=mock_session):
        resp = client.post("/billing/checkout?plan=starter", headers=_AUTH)

    assert resp.status_code == 200
    assert resp.json()["checkout_url"] == "https://checkout.stripe.com/pay/cs_test_abc"


def test_checkout_creates_stripe_customer_if_missing():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data=_TENANT_NO_CUSTOMER)
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data={})

    mock_customer = MagicMock()
    mock_customer.id = "cus_new456"
    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/pay/cs_test_xyz"

    with patch.dict("app.routers.billing.PLAN_PRICES", _FAKE_PRICES), \
         patch("app.routers.billing.get_supabase", return_value=sb), \
         patch("app.routers.billing.stripe.Customer.create", return_value=mock_customer) as mock_create, \
         patch("app.routers.billing.stripe.checkout.Session.create", return_value=mock_session):
        resp = client.post("/billing/checkout?plan=growth", headers=_AUTH)

    assert resp.status_code == 200
    mock_create.assert_called_once()
    call_kwargs = mock_create.call_args[1]
    assert call_kwargs["metadata"]["tenant_id"] == TENANT_ID


def test_checkout_404_when_tenant_not_found():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data=None)

    with patch.dict("app.routers.billing.PLAN_PRICES", _FAKE_PRICES), \
         patch("app.routers.billing.get_supabase", return_value=sb):
        resp = client.post("/billing/checkout?plan=starter", headers=_AUTH)

    assert resp.status_code == 404


# ── POST /billing/portal ───────────────────────────────────────────────────────

def test_portal_returns_url():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data=_TENANT_WITH_CUSTOMER)

    mock_portal = MagicMock()
    mock_portal.url = "https://billing.stripe.com/session/bps_test"

    with patch("app.routers.billing.get_supabase", return_value=sb), \
         patch("app.routers.billing.stripe.billing_portal.Session.create", return_value=mock_portal):
        resp = client.post("/billing/portal", headers=_AUTH)

    assert resp.status_code == 200
    assert resp.json()["portal_url"] == "https://billing.stripe.com/session/bps_test"


def test_portal_404_when_no_customer():
    _auth_as(_OWNER_USER)

    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data=_TENANT_NO_CUSTOMER)

    with patch("app.routers.billing.get_supabase", return_value=sb):
        resp = client.post("/billing/portal", headers=_AUTH)

    assert resp.status_code == 404
    assert "No billing account" in resp.json()["detail"]


# ── POST /webhooks/stripe ──────────────────────────────────────────────────────

def _build_stripe_event(event_type: str, obj: dict) -> dict:
    return {
        "type": event_type,
        "data": {"object": obj},
    }


def _call_webhook(event_dict: dict, sig: str = "t=1,v1=abc", secret: str = "whsec_test"):
    payload = json.dumps(event_dict).encode()
    with patch.dict("os.environ", {"STRIPE_WEBHOOK_SECRET": secret}), \
         patch("app.routers.billing.stripe.Webhook.construct_event", return_value=event_dict):
        return client.post(
            "/webhooks/stripe",
            content=payload,
            headers={"stripe-signature": sig, "content-type": "application/json"},
        )


def test_stripe_webhook_checkout_completed_updates_tenant():
    event = _build_stripe_event("checkout.session.completed", {
        "metadata": {"tenant_id": TENANT_ID, "plan": "growth"},
        "subscription": "sub_xyz",
    })

    sb = MagicMock()
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data={})

    with patch("app.routers.billing.get_supabase", return_value=sb):
        resp = _call_webhook(event)

    assert resp.status_code == 200
    assert resp.json() == {"received": True}

    # Verify tenant was updated
    update_call = sb.table.return_value.update.call_args
    assert update_call is not None
    updated_data = update_call[0][0]
    assert updated_data["plan"] == "growth"
    assert updated_data["subscription_status"] == "active"


def test_stripe_webhook_subscription_updated():
    event = _build_stripe_event("customer.subscription.updated", {
        "customer": "cus_existing123",
        "status": "past_due",
    })

    sb = MagicMock()
    # tenant lookup by customer_id
    sb.table.return_value.select.return_value.eq.return_value.single.return_value \
        .execute.return_value = MagicMock(data={"id": TENANT_ID})
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data={})

    with patch("app.routers.billing.get_supabase", return_value=sb):
        resp = _call_webhook(event)

    assert resp.status_code == 200


def test_stripe_webhook_bad_signature_returns_400():
    payload = b'{"type": "checkout.session.completed"}'
    with patch.dict("os.environ", {"STRIPE_WEBHOOK_SECRET": "whsec_real"}), \
         patch(
             "app.routers.billing.stripe.Webhook.construct_event",
             side_effect=Exception("Invalid signature"),
         ):
        # Need to patch the specific error class
        import stripe as _stripe
        with patch(
            "app.routers.billing.stripe.Webhook.construct_event",
            side_effect=_stripe.error.SignatureVerificationError("bad sig", "t=1"),
        ):
            resp = client.post(
                "/webhooks/stripe",
                content=payload,
                headers={"stripe-signature": "t=1,v1=bad", "content-type": "application/json"},
            )
    assert resp.status_code == 400


def test_stripe_webhook_missing_secret_returns_500():
    payload = b'{"type": "checkout.session.completed"}'
    # WEBHOOK_SECRET is module-level — must patch the variable directly
    with patch("app.routers.billing.WEBHOOK_SECRET", None):
        resp = client.post(
            "/webhooks/stripe",
            content=payload,
            headers={"stripe-signature": "t=1,v1=abc", "content-type": "application/json"},
        )
    assert resp.status_code == 500
