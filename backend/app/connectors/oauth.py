"""CRM OAuth2 connect/callback flows for Toast, Square, and other providers.

Each provider follows the standard OAuth2 Authorization Code flow:
  1. GET /oauth/{provider}/connect   — redirect owner to provider's auth URL
  2. GET /oauth/{provider}/callback  — exchange code for tokens, store in DB

Environment variables per provider:
  {PROVIDER}_CLIENT_ID
  {PROVIDER}_CLIENT_SECRET
  {PROVIDER}_OAUTH_REDIRECT_URI  (or derived from BACKEND_URL)

All tokens are stored in the `oauth_tokens` table with tenant_id for RLS.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import uuid
from typing import Optional
from urllib.parse import urlencode

import httpx
import redis
import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Security
from fastapi.responses import RedirectResponse

from app.auth import get_current_user, get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/oauth", tags=["oauth"])

# ── Provider configurations ─────────────────────────────────────────────────

PROVIDERS: dict[str, dict] = {
    "square": {
        "authorize_url": "https://connect.squareup.com/oauth2/authorize",
        "token_url": "https://connect.squareup.com/oauth2/token",
        "scopes": ["MERCHANT_PROFILE_READ", "ORDERS_READ", "PAYMENTS_READ", "ITEMS_READ"],
        "env_prefix": "SQUARE",
    },
    "toast": {
        "authorize_url": "https://ws-api.toasttab.com/usermgmt/v1/oauth/authorize",
        "token_url": "https://ws-api.toasttab.com/usermgmt/v1/oauth/token",
        "scopes": ["orders.read", "restaurants.read"],
        "env_prefix": "TOAST",
    },
    "servicetitan": {
        "authorize_url": "https://auth.servicetitan.io/connect/authorize",
        "token_url": "https://auth.servicetitan.io/connect/token",
        "scopes": ["jobs", "customers", "invoices"],
        "env_prefix": "SERVICETITAN",
    },
    "housecallpro": {
        "authorize_url": "https://api.housecallpro.com/oauth/authorize",
        "token_url": "https://api.housecallpro.com/oauth/token",
        "scopes": ["read:jobs", "read:invoices", "read:customers"],
        "env_prefix": "HOUSECALLPRO",
    },
    "quickbooks": {
        "authorize_url": "https://appcenter.intuit.com/connect/oauth2",
        "token_url": "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        "scopes": ["com.intuit.quickbooks.accounting"],
        "env_prefix": "QUICKBOOKS",
    },
}

# State store for CSRF — Redis if available, in-memory fallback
_REDIS_URL = os.getenv("REDIS_URL", "")
_OAUTH_STATE_TTL = 600  # 10 minutes
_MEMORY_STORE: dict[str, str] = {}  # fallback when Redis is unavailable


def _get_redis() -> Optional[redis.Redis]:
    if not _REDIS_URL:
        return None
    try:
        r = redis.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        r.ping()
        return r
    except Exception:
        logger.warning("Redis unavailable — using in-memory OAuth state store")
        return None


def _set_oauth_state(state: str, data: dict) -> None:
    r = _get_redis()
    if r:
        r.setex(f"oauth_state:{state}", _OAUTH_STATE_TTL, json.dumps(data))
    else:
        _MEMORY_STORE[state] = json.dumps(data)


def _pop_oauth_state(state: str) -> Optional[dict]:
    r = _get_redis()
    if r:
        key = f"oauth_state:{state}"
        raw = r.get(key)
        if raw:
            r.delete(key)
            return json.loads(raw)
        return None
    else:
        raw = _MEMORY_STORE.pop(state, None)
        return json.loads(raw) if raw else None


def _get_provider_config(provider: str) -> dict:
    """Fetch provider config + env vars. Raises 400 if provider unknown."""
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown OAuth provider: {provider}")

    config = PROVIDERS[provider]
    prefix = config["env_prefix"]
    client_id = os.getenv(f"{prefix}_CLIENT_ID", "")
    client_secret = os.getenv(f"{prefix}_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503,
            detail=f"{provider} OAuth not configured — missing {prefix}_CLIENT_ID / {prefix}_CLIENT_SECRET",
        )

    redirect_uri = os.getenv(
        f"{prefix}_OAUTH_REDIRECT_URI",
        f"{os.getenv('BACKEND_URL', 'http://localhost:8000')}/oauth/{provider}/callback",
    )

    return {
        **config,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    }


# ── Connect (initiate OAuth) ────────────────────────────────────────────────

@router.get("/{provider}/connect")
async def oauth_connect(
    provider: str,
    user: dict = Security(get_current_user),
):
    """Redirect the owner to the CRM provider's OAuth authorization page."""
    config = _get_provider_config(provider)

    # Generate CSRF state token (stored in Redis, expires in 10 min)
    state = secrets.token_urlsafe(32)
    _set_oauth_state(state, {
        "tenant_id": user["tenant_id"],
        "user_id": user["user_id"],
        "provider": provider,
    })

    params = {
        "client_id": config["client_id"],
        "redirect_uri": config["redirect_uri"],
        "response_type": "code",
        "scope": " ".join(config["scopes"]),
        "state": state,
    }

    # Square uses slightly different param name
    if provider == "square":
        params["session"] = "false"

    auth_url = f"{config['authorize_url']}?{urlencode(params)}"
    return {"authorize_url": auth_url}


# ── Callback (exchange code for tokens) ──────────────────────────────────────

@router.get("/{provider}/callback")
async def oauth_callback(
    provider: str,
    code: str = Query(...),
    state: str = Query(...),
):
    """Exchange the authorization code for access/refresh tokens and store them."""
    # Validate CSRF state (atomically pop from Redis)
    state_data = _pop_oauth_state(state)
    if not state_data or state_data["provider"] != provider:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    tenant_id = state_data["tenant_id"]
    config = _get_provider_config(provider)

    # Exchange code for tokens
    token_payload = {
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "code": code,
        "redirect_uri": config["redirect_uri"],
        "grant_type": "authorization_code",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                config["token_url"],
                data=token_payload,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            tokens = resp.json()
    except Exception as exc:
        logger.error("OAuth token exchange failed for %s: %s", provider, exc)
        sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=502, detail=f"Token exchange failed: {exc}")

    # Extract token fields (providers use different key names)
    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in")
    merchant_id = (
        tokens.get("merchant_id")
        or tokens.get("restaurantGuid")
        or tokens.get("company_id")
        or tokens.get("realm_id")
    )

    from datetime import datetime, timedelta, timezone

    expires_at = None
    if expires_in:
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))).isoformat()

    # Store in DB
    supabase = get_supabase()
    try:
        supabase.table("oauth_tokens").upsert(
            {
                "tenant_id": tenant_id,
                "provider": provider,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": tokens.get("token_type", "Bearer"),
                "expires_at": expires_at,
                "scopes": config["scopes"],
                "merchant_id": merchant_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="tenant_id,provider",
        ).execute()

        # Also update the tenant's crm_account_id if we got a merchant_id
        if merchant_id:
            supabase.table("tenants").update(
                {"crm_account_id": str(merchant_id)}
            ).eq("id", tenant_id).execute()

    except Exception as exc:
        logger.error("Failed to store OAuth tokens for %s: %s", provider, exc)
        sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=500, detail="Failed to store OAuth tokens")

    # Redirect back to frontend integrations page
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    return RedirectResponse(
        url=f"{frontend_url}/settings/integrations?connected={provider}",
        status_code=302,
    )


# ── Disconnect ───────────────────────────────────────────────────────────────

@router.delete("/{provider}/disconnect")
async def oauth_disconnect(
    provider: str,
    user: dict = Security(get_current_user),
):
    """Remove stored OAuth tokens for a provider."""
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    supabase = get_supabase()
    supabase.table("oauth_tokens").delete().eq(
        "tenant_id", user["tenant_id"]
    ).eq("provider", provider).execute()

    return {"success": True, "provider": provider}


# ── Status (list connected providers) ────────────────────────────────────────

@router.get("/status")
async def oauth_status(user: dict = Security(get_current_user)):
    """Return which CRM providers the tenant has connected."""
    supabase = get_supabase()
    result = (
        supabase.table("oauth_tokens")
        .select("provider, merchant_id, expires_at, updated_at")
        .eq("tenant_id", user["tenant_id"])
        .execute()
    )
    connected = {}
    for row in result.data or []:
        connected[row["provider"]] = {
            "connected": True,
            "merchant_id": row.get("merchant_id"),
            "expires_at": row.get("expires_at"),
            "updated_at": row.get("updated_at"),
        }

    # Fill in unconnected providers
    for provider in PROVIDERS:
        if provider not in connected:
            connected[provider] = {"connected": False}

    return {"integrations": connected}
