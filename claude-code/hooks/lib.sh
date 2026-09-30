#!/usr/bin/env bash
# Shared helpers for the memory hooks. Sourced, never executed directly.

[ -f "$HOME/.claude/memory.env" ] && . "$HOME/.claude/memory.env"

MEMORY_URL="${MEMORY_URL:-}"
MEMORY_TOKEN="${MEMORY_TOKEN:-}"
MEMORY_EXTRACT_MODEL="${MEMORY_EXTRACT_MODEL:-sonnet}"
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

# Percent-encode one argument for use in a query string.
urlencode() { jq -rn --arg s "$1" '$s|@uri'; }

# Stable short hash. shasum is on macOS and Linux; md5sum is not on stock macOS.
shorthash() { printf '%s' "$1" | shasum -a 256 | cut -c1-16; }

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//' | cut -c1-48
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
    basename "$hint" .git | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed -e 's/-\{2,\}/-/g' -e 's/^-//' -e 's/-$//'
  fi
}

# --- git safety -------------------------------------------------------------

# True when the repo is mid-operation and an automatic commit would interfere.
git_busy() {
  local g
  g="$(git -C "$1" rev-parse --git-dir 2>/dev/null)" || return 0
  [ -d "$1/$g/rebase-merge" ] || [ -d "$1/$g/rebase-apply" ] && return 0
  [ -e "$1/$g/MERGE_HEAD" ] || [ -e "$1/$g/CHERRY_PICK_HEAD" ] || [ -e "$1/$g/REVERT_HEAD" ] && return 0
  # Detached HEAD: committing here strands the commit on no branch.
  git -C "$1" symbolic-ref -q HEAD >/dev/null 2>&1 || return 0
  return 1
}

MEMORY_PENDING_LOG="$HOME/.claude/memory-pending-commits.log"

# Records a repo whose notes were written but not committed, so the next
# SessionStart in that repo can finish the job.
note_pending_commit() {
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$1" >> "$MEMORY_PENDING_LOG"
}
