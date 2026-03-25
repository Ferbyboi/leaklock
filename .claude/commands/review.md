# /review — Security & Quality Audit (Opus)

Spawn an Opus sub-agent to run a thorough security and quality audit on the diff since main.

## Sub-agent instructions

Use `model: opus` for this audit. Do the following:

### 1. Get the diff
```
git diff main...HEAD --name-only
git diff main...HEAD
```

### 2. LeakLock-specific checks (must pass all)

**Tenant isolation**
- Every Supabase query filters by `tenant_id` — no exceptions
- No query that could return cross-tenant data
- RLS policies exist on all tables touched

**Auth & RBAC**
- Every protected route uses `Security(require_role(...))` or `Security(get_current_user)`
- No route exposes data without auth
- Role checks are enforced before DB queries

**OWASP Top 10**
- No SQL injection vectors (parameterized queries only)
- No hardcoded secrets or API keys in code
- No unvalidated user input passed to shell commands
- No sensitive data in logs or error messages

**Async discipline**
- No blocking I/O calls (requests, anthropic, supabase) in sync Celery tasks without `asyncio.run()`
- No `time.sleep()` in route handlers

**Data immutability**
- `reconciliation_results` rows are INSERT only — no UPDATE or DELETE
- `parsed_items` is not re-written for completed jobs

### 3. General code quality
- Functions over 50 lines should be flagged for review
- No `except Exception: pass` silently swallowing errors
- Every new route has a corresponding pytest test
- No `TODO` comments left in production paths

### 4. Output format
```
## Security Audit — <date>

### ✅ Passed
- (list passing checks)

### ⚠️ Warnings
- (non-blocking issues with file:line references)

### ❌ Failures
- (blocking issues — must fix before merge, with file:line references)

### Verdict: PASS / FAIL
```

If any ❌ Failures are found, fix them immediately and re-run the audit.
