#!/bin/bash
# PostToolUse hook — auto-lints after every Write/Edit/MultiEdit
# Runs Ruff (Python) + Prettier (TS/React/JSON). Timeout: 10s.

FILE="$1"

if [ -z "$FILE" ]; then
  exit 0
fi

# Python files — run Ruff
if [[ "$FILE" == *.py ]]; then
  if command -v ruff &> /dev/null; then
    ruff check --fix "$FILE" 2>/dev/null
    ruff format "$FILE" 2>/dev/null
  fi
fi

# TypeScript / React / JSON files — run Prettier
if [[ "$FILE" == *.ts || "$FILE" == *.tsx || "$FILE" == *.js || "$FILE" == *.jsx || "$FILE" == *.json ]]; then
  if command -v prettier &> /dev/null; then
    prettier --write "$FILE" 2>/dev/null
  fi
fi

exit 0
