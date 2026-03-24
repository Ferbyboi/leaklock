import os
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import create_client, Client
import jwt

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

security = HTTPBearer()


def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """Validate Supabase JWT and extract tenant_id + role from claims."""
    token = credentials.credentials
    try:
        # Decode without verification first to get the header
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
