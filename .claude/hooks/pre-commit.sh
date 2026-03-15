#!/bin/bash
set -e

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only trigger on git commit commands
if ! echo "$COMMAND" | grep -q "git commit"; then
  exit 0
fi

echo "Running lint check..." >&2
bunx biome check . 2>&1 >&2 || {
  echo "Lint errors found. Fix them before committing." >&2
  exit 2
}

echo "Running tests..." >&2
bun test client/ server/ 2>&1 >&2 || {
  echo "Tests failed. Fix them before committing." >&2
  exit 2
}

echo "All checks passed." >&2
exit 0
