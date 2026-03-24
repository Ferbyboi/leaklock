## Summary
-

## Changes
-

## Checklist
- [ ] Every DB query filters by `tenant_id`
- [ ] Auth0 JWT validated + role checked on all new routes
- [ ] No blocking calls in HTTP handlers (async work in Celery)
- [ ] Every new table has RLS policy
- [ ] All exceptions caught + sent to Sentry with `job_id`
- [ ] Tests added — coverage ≥ 80%
- [ ] No secrets committed — `.env` stays gitignored
- [ ] `.env` is NOT included in this PR

## Test Coverage
- Coverage %:

## Sentry Check
- [ ] Verified exceptions log with `job_id` context
