# /cost — Session Cost Summary

Report a cost and efficiency summary for this session.

## Steps

1. **Context usage**
   State the approximate context window % used this session and whether /compact should be run per these thresholds:
   - 0–50%: Fine, keep working
   - 50–70%: Consider /compact soon
   - 70–85%: Run /compact NOW
   - 85–100%: Run /clear MANDATORY

2. **Model routing check**
   Review what models were used this session against the routing table:
   | Task type              | Target model | Notes |
   |------------------------|-------------|-------|
   | File reads, searches   | haiku       | Cheapest — use subagents |
   | Unit tests, simple edits | haiku    |       |
   | Default coding         | opusplan    | Current session default |
   | Architecture, RLS design | opus     | High effort tasks |
   | Field note parsing     | sonnet      | Production AI calls |

   Flag any tasks that used a more expensive model than needed.

3. **Session work summary**
   Briefly list the key things completed this session (commits, files changed, features shipped).

4. **Cost optimization tips for next session**
   Based on what was done, suggest 1-2 specific things to do cheaper next time
   (e.g. "Use a Haiku subagent for the file search steps").

5. **Reminder**
   - Run `/compact` if context is above 70%
   - Push any uncommitted work before ending
   - Verify CI is green on the current branch
