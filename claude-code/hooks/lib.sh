#!/usr/bin/env bash
# Shared helpers for the memory hooks. Sourced, never executed directly.

[ -f "$HOME/.claude/memory.env" ] && . "$HOME/.claude/memory.env"

MEMORY_URL="${MEMORY_URL:-}"
MEMORY_TOKEN="${MEMORY_TOKEN:-}"
MEMORY_EXTRACT_MODEL="${MEMORY_EXTRACT_MODEL:-haiku}"
DEVICE="$(hostname -s 2>/dev/null || echo unknown)"

# Every hook exits 0, so a missing config must be a quiet no-op, not a failure.
mem_configured() { [ -n "$MEMORY_URL" ] && [ -n "$MEMORY_TOKEN" ]; }

mem_get() {
  curl -sS --max-time 10 "$MEMORY_URL$1" -H "Authorization: Bearer $MEMORY_TOKEN"
}

mem_post() {
  curl -sS --max-time 30 -X POST "$MEMORY_URL$1" \
    -H "Authorization: Bearer $MEMORY_TOKEN" \
    -H "Content-Type: application/json" --data-binary @-
}

# Best-effort project slug from the git remote, falling back to the directory name.
# Matching happens server-side against repo_names/aliases in /api/projects.
detect_project() {
  local hint slug
  hint="$(git remote get-url origin 2>/dev/null || basename "$PWD")"
  slug="$(mem_get "/api/projects" 2>/dev/null | jq -r --arg h "$(printf '%s' "$hint" | tr '[:upper:]' '[:lower:]')" '
    [ .projects[]?
      | . as $p
      | ([$p.slug] + ($p.aliases // []) + ($p.repo_names // []))
      | map(select(. != null and . != "") | ascii_downcase)
      | map(select(inside($h)))
      | select(length > 0)
      | { slug: $p.slug, len: (max_by(length) | length) }
    ] | sort_by(-.len) | .[0].slug // empty' 2>/dev/null)"

  if [ -n "$slug" ]; then
    printf '%s' "$slug"
  else
    # Unknown repo: derive a slug locally so the first session still lands somewhere sane.
    basename "$hint" .git | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed -e 's/-\{2,\}/-/g' -e 's/^-//' -e 's/-$//'
  fi
}
