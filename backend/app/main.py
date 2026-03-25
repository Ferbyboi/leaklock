import os
import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sentry_sdk.integrations.asgi import SentryAsgiMiddleware

sentry_sdk.init(dsn=os.getenv("SENTRY_DSN"), traces_sample_rate=0.1)

app = FastAPI(title="LeakLock API", version="0.1.0")

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


from app.routers import jobs, webhooks, billing, reconciliation, onboarding

app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(webhooks.router, tags=["webhooks"])
app.include_router(billing.router, tags=["billing"])
app.include_router(reconciliation.router, tags=["reconciliation"])
app.include_router(onboarding.router, tags=["onboarding"])
