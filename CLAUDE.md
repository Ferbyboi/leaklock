# LeakLock Revenue Reconciliation Guardrail — Project Constitution

## Product
Automated revenue reconciliation engine for service businesses.
Field data (photos, voice, notes) → structured JSON → 3-way match against
quote + invoice → STOP alert if work done but not billed.

## THE ONLY RULE THAT MATTERS
IF (item in Input B) does NOT exist in (Input C) → REVENUE_LEAK_ALERT → Hold Invoice + Notify Owner.

## Stack
Backend:    FastAPI (Python 3.12) + Celery + Redis
Frontend:   Next.js 14 (App Router) + Tailwind CSS
Database:   Supabase PostgreSQL + Row Level Security
Auth:       Supabase Auth (JWT) — roles: owner | auditor | tech
Storage:    Supabase Storage (field photos)
AI:         Anthropic Claude claude-sonnet-4-6 (field note parsing)
OCR:        Tesseract (image → text pipeline)
Workflows:  Trigger.dev (webhook ingestion + retries)
Deploy:     Railway (API + workers) + Vercel (frontend)
Monitor:    Sentry (errors) + PostHog (product analytics)

## Model Routing
| Task                          | Model    | Effort |
| Field note parsing (prod)     | sonnet   | medium |
| Schema design, RLS policy     | opus     | high   |
| Unit tests, file reading      | haiku    | low    |
| Default coding sessions       | opusplan | medium |

## Non-Negotiable Rules
1. Every DB query filters by tenant_id — no exceptions
2. Every table has RLS policy before any data goes in
3. ALL AI parsing calls are async via Celery — never block HTTP
4. Exceptions go to Sentry with job_id context
5. Every new route has a pytest test — 80% coverage minimum
6. Never commit .env — use Supabase Vault for prod secrets
7. Never push to main — feature branch + PR always
8. Three-Way Match result is immutable once written — append only
9. False positive rate tracked in PostHog — alert if > 5%
10. Run /cost at end of every session

## Cost Optimization Rules
- Use Haiku to pre-screen field notes before sending to Sonnet (< 10 words = skip)
- Never re-parse a completed job — parsed_items is immutable
- Batch low-priority jobs (< $200) every 4 hours instead of real-time
- Always run Tesseract OCR before Claude — never send raw images to Claude Vision
- NEVER switch models mid-session — breaks prompt caching

## KPI Targets
- Catch rate: > 85%
- False positive rate: < 5% (most important in month 1)
- Parse success rate: > 95%
- Avg revenue recovered: > $200/job
- Webhook reliability: > 99%

## Key Commands
/ship    — tests → commit → PR → CI check
/match   — run three-way match on a specific job_id
/ingest  — manually trigger field note parsing for a job
/review  — security audit (uses Opus)
/cost    — current session token cost

## When Stuck
Complex parsing logic: use sequential-thinking MCP to plan first
Library docs: use context7 MCP for live API references
Production error: /debug [error] — reads Sentry, writes fix, ships PR

## Context Management
- 0–50%: Work freely.
- 50–70%: Consider /compact soon.
- 70–85%: Run /compact NOW.
- 85–100%: Run /clear MANDATORY.
