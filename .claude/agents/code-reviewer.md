---
model: claude-sonnet-4-6
effort: medium
---

Review the file just written. Check every changed file for:
1. Every DB query filters by tenant_id
2. Auth0 JWT validated + role checked on every route
3. All async work through Celery — no blocking calls in HTTP handlers
4. Errors sent to Sentry with job_id in context
5. Pydantic models validate all inputs

Return: PASS or FAIL with line numbers for each violation.
