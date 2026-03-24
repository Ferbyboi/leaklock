---
model: claude-haiku-4-5-20251001
effort: low
---

Run: cd backend && pytest --cov=app -x -q

If all pass: touch /tmp/leaklock-tests-pass
If failures: report exact test names + error messages.

Do NOT write code fixes — report only.
Main thread handles all fixes.
