#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit) — shows why this file changed before, at the
# moment Claude is about to change it again.
#
# PreToolUse ignores plain stdout, unlike SessionStart. Context only reaches the
# model through hookSpecificOutput.additionalContext, so this emits JSON.
set -uo pipefail
. "$HOME/.claude/hooks/lib.sh"

mem_configured || exit 0
command -v jq >/dev/null 2>&1 || exit 0

payload="$(cat)"
file="$(jq -r '.tool_input.file_path // empty' <<<"$payload" 2>/dev/null)"
[ -z "$file" ] && exit 0

session="$(jq -r '.session_id // "nosession"' <<<"$payload" 2>/dev/null)"
repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
rel="${file#"${repo:-}/"}"

# One lookup per file per session: repeated edits of the same file add nothing.
cache="/tmp/memory-pretool-$session"
mkdir -p "$cache" 2>/dev/null || exit 0
key="$(shorthash "$rel")"
[ -e "$cache/$key" ] && exit 0
touch "$cache/$key"

out="$(mem_get "/api/file-context?path=$(urlencode "$rel")&k=3" 2>/dev/null)" || exit 0

# The endpoint returns {path, items}, so an empty result is items:[] — testing
# the whole body against "[]" never matches and would emit a bare header.
jq -e '.items | length > 0' >/dev/null 2>&1 <<<"$out" || exit 0

# Context budget: at most 3 items, one line each, plus a header.
context="$(jq -r '
  "[memory] Earlier work on \(.path):",
  (.items[] | "- \(.date) · \(.summary)"
    + (if .why != "" then " — because: \(.why)" else "" end)
    + (if .ref != "" then " → \(.ref)" else "" end))
' <<<"$out" | cut -c1-240 | head -4)"

[ -z "$context" ] && exit 0

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: $ctx
  }
}'
exit 0
