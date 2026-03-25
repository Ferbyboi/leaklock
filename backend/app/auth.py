from __future__ import annotations

import os
import logging
from typing import Optional
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import create_client, Client
import jwt
from jwt import PyJWKClient

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

security = HTTPBearer()
logger = logging.getLogger(__name__)

# JWKS client for ES256 (Supabase new JWT signing keys)
_jwks_client: PyJWKClient | None = None

def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None and SUPABASE_URL:
        _jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def _decode_token(token: str) -> dict:
    """Decode Supabase JWT — supports ES256 (new) and HS256 (legacy) signing."""
    # Try ES256 via JWKS first (new Supabase tokens)
    client = _get_jwks_client()
    if client:
        try:
            signing_key = client.get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
            )
        except Exception:
            pass

    # Fall back to HS256 with legacy secret
    if SUPABASE_JWT_SECRET:
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )

    # Dev fallback — no signature verification
    logger.warning("SUPABASE_JWT_SECRET not set — skipping JWT signature verification")
    return jwt.decode(token, options={"verify_signature": False}, algorithms=["HS256", "ES256", "RS256"])


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """Validate Supabase JWT and extract tenant_id + role from claims."""
    token = credentials.credentials
    try:
        payload = _decode_token(token)
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )

    # Claims may be top-level (custom hook) or under app_metadata (default Supabase)
    app_meta = payload.get("app_metadata") or {}
    tenant_id = payload.get("tenant_id") or app_meta.get("tenant_id")
    user_role = payload.get("user_role") or app_meta.get("user_role")
    user_id = payload.get("sub")

    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token missing tenant_id claim — user not provisioned",
        )

    return {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "role": user_role,
    }


def require_role(*roles: str):
    """Dependency factory — enforces role-based access."""
    def _check(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
        user = get_current_user(credentials)
        if user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user['role']}' not permitted. Required: {roles}",
            )
        return user
    return _check
