# LeakLock — Revenue Reconciliation Guardrail

Automated three-way match engine for service businesses. Field data (photos, voice, notes) → structured JSON → matched against quote + invoice → **STOP alert if work was done but not billed.**

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + Tailwind CSS — deployed on Vercel |
| Backend | FastAPI (Python 3.12) + Celery workers — deployed on Railway |
| Database | Supabase PostgreSQL + Row Level Security |
| Auth | Supabase Auth — roles: `owner` / `auditor` / `tech` |
| Storage | Supabase Storage (field photos, voice recordings) |
| AI | Anthropic Claude `claude-sonnet-4-6` (field note parsing) |
| OCR | Tesseract (image → text before sending to Claude) |
| Webhooks | Trigger.dev (ingestion + retries) |
| Billing | Stripe (Starter $49 / Pro $149 / Enterprise $499) |
| Monitoring | Sentry (errors) + PostHog (product analytics) |

---

## Quick Start (Local)

### Prerequisites
- Node.js 20+
- Python 3.12+
- Docker + Docker Compose (for local Postgres + Redis)

### 1. Clone and install

```bash
git clone https://github.com/your-org/leaklock.git
cd leaklock

# Frontend
cd frontend && npm install && cd ..

# Backend
cd backend && pip install -r requirements.txt && cd ..
```

### 2. Configure environment variables

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Edit both files — at minimum you need:

**`frontend/.env.local`**
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**`backend/.env`**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret
REDIS_URL=redis://localhost:6379/0
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Start infrastructure (Postgres + Redis)

```bash
docker compose up db redis -d
```

### 4. Run Supabase migrations

```bash
# With Supabase CLI (recommended)
supabase db push

# Or apply migrations manually against local Postgres
psql postgresql://postgres:postgres@localhost:5432/leaklock \
  -f supabase/migrations/001_initial_schema.sql \
  # ... through 026_api_keys.sql
```

### 5. Start the services

```bash
# Terminal 1 — Backend API
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — Celery worker
cd backend && celery -A app.celery_app worker --loglevel=info

# Terminal 3 — Frontend
cd frontend && npm run dev
```

App is at **http://localhost:3000**. API docs at **http://localhost:8000/docs**.

### Docker Compose (full stack)

```bash
docker compose up --build
```

This starts Postgres, Redis, FastAPI, Celery worker, and Next.js all together.

---

## Project Structure

```
leaklock/
├── frontend/               # Next.js 14 App Router
│   ├── app/
│   │   ├── (auth)/         # login, signup, onboarding, forgot/reset password
│   │   ├── (dashboard)/    # all protected pages
│   │   │   ├── jobs/       # job list + job detail [id]
│   │   │   ├── alerts/     # real-time alert inbox
│   │   │   ├── reports/    # 90-day revenue recovery report + PDF download
│   │   │   ├── auditor/    # reconciliation review queue
│   │   │   ├── field/      # voice/photo/text field capture
│   │   │   ├── tech/       # technician daily schedule
│   │   │   ├── team/       # invite + manage team members
│   │   │   ├── billing/    # Stripe plan management
│   │   │   ├── schedule/   # maintenance calendar
│   │   │   └── settings/   # profile + notification prefs + API keys
│   │   └── api/            # Next.js API routes (thin proxies + Stripe webhooks)
│   ├── components/
│   │   ├── ui/             # shared components (GlobalSearch, CommandPalette, etc.)
│   │   ├── field/          # VoiceRecorder, PhotoCapture, TextNoteForm, FieldDrawer
│   │   └── dashboard/      # RealtimeProvider, NicheToggle, AuditorReviewButtons
│   └── e2e/                # Playwright end-to-end tests
│
├── backend/                # FastAPI + Celery
│   ├── app/
│   │   ├── routers/        # jobs, alerts, billing, reports, notifications, webhooks, team
│   │   ├── core/           # match_engine, alert_engine, claude_client, notification_service
│   │   ├── workers/        # Celery tasks (parse field notes, run reconciliation, FP rate check)
│   │   └── connectors/     # ServiceTitan, HousecallPro, Jobber webhook receivers
│   └── tests/              # pytest test suite (80%+ coverage target)
│
├── supabase/
│   ├── migrations/         # 026 numbered SQL migrations with RLS policies
│   └── functions/          # Deno edge functions (process-voice, process-photo, etc.)
│
└── docker-compose.yml      # Full local stack
```

---

## Core Business Logic

### The Only Rule That Matters

> **IF** (item in field notes / Input B) does **NOT** exist in (invoice / Input C) → `REVENUE_LEAK_ALERT` → Hold Invoice + Notify Owner

### Three-Way Match Flow

```
CRM webhook → jobs table → Celery parse task
    → Claude extracts line items from field notes
    → match_engine compares against invoice
    → reconciliation_results: { status, missing_items, estimated_leak_cents }
    → if discrepancy: create alert → notify owner via email/SMS/Slack
    → auditor reviews → confirm_leak | false_positive | waived
```

### Plan Gates

| Feature | Required Plan |
|---------|--------------|
| Reports, Photo AI | Pro ($149/mo) |
| API Access, Webhooks | Enterprise ($499/mo) |

---

## Running Tests

### Backend (pytest)

```bash
cd backend
pytest --cov=app --cov-report=term-missing
```

Target: **≥ 80% coverage**.

### Frontend (Playwright E2E)

```bash
cd frontend
npx playwright install chromium
npx playwright test
```

Tests run against the local dev server. They degrade gracefully when no real Supabase session is available — auth-gated assertions are skipped rather than failed.

---

## Deployment

### Frontend → Vercel

```bash
cd frontend && vercel --prod
```

Set all env vars from `frontend/.env.example` in the Vercel dashboard.

### Backend → Railway

1. Create a Railway project, add a Redis service
2. Deploy the `backend/` directory (Railway auto-detects the Dockerfile)
3. Set all env vars from `backend/.env.example` in Railway's environment settings
4. Copy the deployed URL → set `NEXT_PUBLIC_API_URL` in Vercel

### Database → Supabase

```bash
supabase link --project-ref your-project-ref
supabase db push
```

### Stripe Webhook

After deployment, register the webhook endpoint in your Stripe dashboard:
- **URL**: `https://your-vercel-app.vercel.app/api/stripe/webhook`
- **Events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET` in Vercel

Test end-to-end with the Stripe CLI:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger checkout.session.completed
```

### Supabase Edge Functions

```bash
supabase functions deploy process-voice
supabase functions deploy process-photo
supabase functions deploy evaluate-compliance
supabase functions deploy send-notification
supabase functions deploy stripe-webhook

# Set edge function secrets
supabase secrets set DEEPGRAM_API_KEY=your-key
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

---

## KPI Targets

| Metric | Target |
|--------|--------|
| Catch rate | > 85% |
| False positive rate | < 5% |
| Parse success rate | > 95% |
| Avg revenue recovered | > $200/job |
| Webhook reliability | > 99% |

---

## Supported Niches

LeakLock ships with industry-specific field note parsing and PDF audit sections for:

- **Restaurant** — hood inspection checklist, temperature log
- **HVAC** — refrigerant log, pressure readings
- **Tree Service** — tree inventory (species, DBH), hazard assessment
- **Landscaping** — plant species list, irrigation zones
- **Barber / Salon** — service menu, chemical applications

Switch niches per tenant in the sidebar **Industry** toggle.

---

## Security

- Every DB query filters by `tenant_id` — cross-tenant data access is impossible
- Every table has an RLS policy before any data is written
- All AI parsing calls are async via Celery — HTTP requests never block
- Exceptions go to Sentry with `job_id` context
- API keys stored as SHA-256 hash only — raw key shown once at creation
- Webhook HMAC validation for all CRM connectors

---

## License

Proprietary — all rights reserved.
