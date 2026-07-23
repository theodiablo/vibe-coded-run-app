#!/bin/bash
# SessionStart hook for Claude Code on the web: install npm deps so
# lint/test/typecheck/build work without a manual `npm install` first.
set -euo pipefail

# Only needed in remote (web) sessions; local checkouts manage their own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Idempotent: npm install is a fast no-op when node_modules is already current,
# and postinstall (patch-package) re-applies the committed native plugin patches.
npm install --no-audit --no-fund
