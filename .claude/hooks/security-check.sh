#!/bin/bash
# PreToolUse hook — blocks dangerous commands before execution
# Runs on every Bash tool call. Timeout: 5s.

COMMAND="$1"

# Block patterns
DANGEROUS_PATTERNS=(
  "rm -rf"
  "git push.*main"
  "git push.*--force"
  "DROP TABLE"
  "DELETE FROM.*WHERE"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    echo "BLOCKED: Dangerous command pattern detected: '$pattern'"
    echo "Command: $COMMAND"
    exit 1
  fi
done

exit 0
