import logging
import os
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sentry_sdk.integrations.asgi import SentryAsgiMiddleware

logger = logging.getLogger(__name__)

sentry_sdk.init(dsn=os.getenv("SENTRY_DSN"), traces_sample_rate=0.1)

_REQUIRED_ENV = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
]

# At least one JWT secret must be present (SUPABASE_JWT_SECRET preferred, JWT_SECRET legacy)
def _check_jwt_secret():
    if not os.getenv("SUPABASE_JWT_SECRET") and not os.getenv("JWT_SECRET"):
        raise RuntimeError(
            "Missing JWT signing secret — set SUPABASE_JWT_SECRET (preferred) or JWT_SECRET"
        )

# Optional — absence disables the channel but the app still starts
_OPTIONAL_ENV_GROUPS = {
    "Email alerts (Resend)": ["RESEND_API_KEY"],
    "SMS alerts (Twilio)": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
    "Slack alerts": ["SLACK_WEBHOOK_URL"],
    "Stripe billing": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    "Rate limiting (Upstash Redis)": ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    "Web Push (VAPID)": ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
}

# Upstash Redis — used for per-tenant notification rate limiting
# UPSTASH_REDIS_REST_URL: str = ""   (set in environment / Supabase Vault)
# UPSTASH_REDIS_REST_TOKEN: str = "" (set in environment / Supabase Vault)


@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = [k for k in _REQUIRED_ENV if not os.getenv(k)]
    if missing:
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
    _check_jwt_secret()

    for group, keys in _OPTIONAL_ENV_GROUPS.items():
        missing_optional = [k for k in keys if not os.getenv(k)]
        if missing_optional:
            logger.warning(
                "%s disabled — missing env vars: %s",
                group,
                ", ".join(missing_optional),
            )

    yield


app = FastAPI(title="LeakLock API", version="0.1.0", lifespan=lifespan)

_frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
_cors_origins = list({
    "http://localhost:3000",
    "https://leaklock.io",
    _frontend_url,
})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SentryAsgiMiddleware)



@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    """Deep readiness check — verifies Supabase and Redis connectivity."""
    import asyncio
    checks: dict = {}
    ok = True

    # Supabase
    try:
        from app.db import get_db
        db = get_db()
        db.table("tenants").select("id").limit(1).execute()
        checks["supabase"] = "ok"
    except Exception as exc:
        checks["supabase"] = f"error: {exc}"
        ok = False

    # Redis
    try:
        import redis as redis_lib
        r = redis_lib.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), socket_connect_timeout=2)
        r.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"
        ok = False

    status_code = 200 if ok else 503
    from fastapi.responses import JSONResponse
    return JSONResponse({"status": "ready" if ok else "degraded", "checks": checks}, status_code=status_code)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Catch-all — ensures unhandled exceptions are sent to Sentry with request context."""
    import sentry_sdk
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("url", str(request.url))
        scope.set_tag("method", request.method)
        sentry_sdk.capture_exception(exc)
    logger.exception("Unhandled exception on %s %s", request.method, request.url)
    from fastapi.responses import JSONResponse
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


from app.routers import jobs, webhooks, billing, reconciliation, onboarding, reports, alerts, team, notifications
from app.routers import webhooks_jobber
from app.routers import ocr
from app.routers import diagnostic
from app.routers import insurance_letter
from app.routers import twilio_sms
from app.connectors import servicetitan as connector_servicetitan
from app.connectors import housecallpro as connector_housecallpro
from app.connectors import toast as connector_toast
from app.connectors import square as connector_square
from app.connectors import oauth as connector_oauth
from app.routers import push

app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(webhooks.router, tags=["webhooks"])
app.include_router(webhooks_jobber.router, tags=["webhooks"])
app.include_router(connector_servicetitan.router, tags=["webhooks"])
app.include_router(connector_housecallpro.router, tags=["webhooks"])
app.include_router(connector_toast.router, tags=["webhooks"])
app.include_router(connector_square.router, tags=["webhooks"])
app.include_router(billing.router, tags=["billing"])
app.include_router(reconciliation.router, tags=["reconciliation"])
app.include_router(onboarding.router, tags=["onboarding"])
app.include_router(reports.router)
app.include_router(insurance_letter.router)
app.include_router(alerts.router, tags=["alerts"])
app.include_router(team.router, tags=["team"])
app.include_router(notifications.router, tags=["notifications"])
app.include_router(ocr.router, tags=["ocr"])
app.include_router(diagnostic.router, tags=["diagnostic"])
app.include_router(twilio_sms.router)
app.include_router(push.router, tags=["push"])
app.include_router(connector_oauth.router, tags=["oauth"])
