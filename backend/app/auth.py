import os
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import create_client, Client
import jwt

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
# Supabase JWT secret — found in Dashboard → Settings → API → JWT Secret
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

security = HTTPBearer()


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """Validate Supabase JWT and extract tenant_id + role from claims."""
    token = credentials.credentials
    try:
        if SUPABASE_JWT_SECRET:
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            # Fallback for local dev without secret set — log warning
            import logging
            logging.getLogger(__name__).warning(
                "SUPABASE_JWT_SECRET not set — skipping JWT signature verification"
            )
            payload = jwt.decode(
                token,
                options={"verify_signature": False},
                algorithms=["HS256"],
            )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )

    tenant_id = payload.get("tenant_id")
    user_role = payload.get("user_role")
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
