#!/usr/bin/env bash
# SessionStart hook — prints the memory timeline into Claude Code's context.
# Deterministic: no model involved, so it cannot be skipped.
set -uo pipefail
. "$HOME/.claude/hooks/lib.sh"

mem_configured || exit 0
command -v jq >/dev/null 2>&1 || exit 0

project="$(detect_project 2>/dev/null || true)"
days="${MEMORY_SUMMARY_DAYS:-30}"

summary="$(mem_get "/api/summary?project=${project}&days=${days}" 2>/dev/null || true)"

if [ -z "$summary" ]; then
  echo "(memory server unreachable — proceed without long-term context)"
  exit 0
fi

echo "# Long-term memory${project:+ — $project}"
echo
echo "$summary"
exit 0
