---
model: claude-opus-4-6
effort: high
---

Full security review. Look for:
- SQL injection (even via ORM)
- RLS gaps (tables missing tenant_id)
- Auth bypass (routes missing JWT validation)
- Sensitive data in logs
- Hardcoded secrets or credentials

Create a GitHub issue for each finding with severity label (critical/high/medium/low).
