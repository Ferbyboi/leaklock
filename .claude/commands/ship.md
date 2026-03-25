# /ship — Test → Commit → PR → CI

Run this full sequence. Stop and report if any step fails.

## Steps

1. **Run tests**
   ```
   cd backend && python -m pytest tests/ -v --tb=short
   ```
   If any tests fail, fix them before continuing. Do not ship broken tests.

2. **Check git status**
   Show what files are staged vs unstaged. Ask the user to confirm if there are unexpected files.

3. **Commit**
   - Stage relevant files (not .env, not secrets)
   - Write a concise commit message: `<type>: <what and why>` (feat/fix/test/refactor/docs)
   - Append `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

4. **Push**
   Push to the current feature branch. Never push to `main` or `master`.

5. **PR**
   - If no open PR exists for this branch, create one with `gh pr create`
   - If a PR already exists, just show its URL
   - PR body must include: Summary (bullet points), Test plan (checklist), link to related issue if any

6. **CI check**
   Wait ~60 seconds, then check `gh run list --branch <current-branch> --limit 3` for status.
   If CI fails, read the logs and fix immediately.

## Rules
- Never use `--no-verify`
- Never push to main
- If tests fail at step 1, stop — do not commit
