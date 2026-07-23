#!/bin/bash
# SessionStart hook for Claude Code on the web: install npm deps so
# lint/test/typecheck/build work without a manual `npm install` first.
set -euo pipefail

# Only needed in remote (web) sessions; local checkouts manage their own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# CLAUDE_PROJECT_DIR is set in the SessionStart hook context but not when this
# script is reused as an environment setup script — fall back to the repo root
# relative to this file, then to the current directory.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/../.." 2>/dev/null && pwd || pwd)}"

# Idempotent: npm install is a fast no-op when node_modules is already current,
# and postinstall (patch-package) re-applies the committed native plugin patches.
npm install --no-audit --no-fund
