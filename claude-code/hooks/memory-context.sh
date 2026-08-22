#!/usr/bin/env bash
# SessionStart hook — prints the memory timeline into Claude Code's context.
# Deterministic: no model involved, so it cannot be skipped.
set -uo pipefail
. "$HOME/.claude/hooks/lib.sh"

mem_configured || exit 0
command -v jq >/dev/null 2>&1 || exit 0

project="$(detect_project 2>/dev/null || true)"
days="${MEMORY_SUMMARY_DAYS:-30}"
repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"

# Commit notes a previous Stop hook wrote but could not commit (rebase, merge,
# detached HEAD). Doing it here means they land as soon as the repo is calm.
if [ -n "$repo" ] && [ -s "$MEMORY_PENDING_LOG" ] && grep -qF "$repo" "$MEMORY_PENDING_LOG" 2>/dev/null; then
  if ! git_busy "$repo" && [ -d "$repo/docs/memory" ]; then
    git -C "$repo" add docs/memory 2>/dev/null
    if ! git -C "$repo" diff --cached --quiet -- docs/memory 2>/dev/null; then
      git -C "$repo" commit -q -m "memory: pending session notes" -- docs/memory 2>/dev/null \
        && echo "(committed memory notes deferred from an earlier session)"
    fi
    grep -vF "$repo" "$MEMORY_PENDING_LOG" > "$MEMORY_PENDING_LOG.tmp" 2>/dev/null \
      && mv "$MEMORY_PENDING_LOG.tmp" "$MEMORY_PENDING_LOG"
  fi
fi

summary="$(mem_get "/api/summary?project=$(urlencode "${project:-}")&days=${days}" 2>/dev/null || true)"

if [ -z "$summary" ]; then
  echo "(memory server unreachable — proceed without long-term context)"
  exit 0
fi

echo "# Long-term memory${project:+ — $project}"
echo
echo "$summary"

# Paths only, not contents — the map itself is read on demand via CLAUDE.md.
if [ -n "$repo" ]; then
  arch="$repo/docs/memory/architecture.md"
  if [ -f "$arch" ]; then
    updated="$(grep -o '_Last auto-update: [0-9-]*' "$arch" 2>/dev/null | head -1 | awk '{print $3}')"
    echo
    echo "Architecture map: docs/memory/architecture.md${updated:+ (updated $updated)}"
  fi
  if [ -d "$repo/docs/memory/decisions" ]; then
    recent="$(ls -t "$repo/docs/memory/decisions"/*.md 2>/dev/null | head -3 \
      | sed "s|$repo/||" | sed 's/^/  - /')"
    [ -n "$recent" ] && { echo "Recent ADRs:"; echo "$recent"; }
  fi
fi

exit 0
