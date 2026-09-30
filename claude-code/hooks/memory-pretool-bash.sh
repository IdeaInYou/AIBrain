#!/usr/bin/env bash
# PreToolUse (Bash) — only for commands that have historically gone wrong:
# deploys, migrations, compose. Catches "last time this broke because X".
set -uo pipefail
. "$HOME/.claude/hooks/lib.sh"

mem_configured || exit 0
command -v jq >/dev/null 2>&1 || exit 0

payload="$(cat)"
# First line only: heredoc bodies and JSON payloads mention "deploy" or
# "OpenSearch" as data, and a whole script makes a meaningless search query.
cmd="$(jq -r '.tool_input.command // empty' <<<"$payload" 2>/dev/null | head -n1 | cut -c1-200)"
[ -z "$cmd" ] && exit 0

# Narrow on purpose: firing for every `ls` would be pure context noise.
printf '%s' "$cmd" | grep -Eqi 'docker[ -]compose|traefik|deploy|migrat|reindex|opensearch|certbot|systemctl' || exit 0

session="$(jq -r '.session_id // "nosession"' <<<"$payload" 2>/dev/null)"
cache="/tmp/memory-pretool-$session"
mkdir -p "$cache" 2>/dev/null || exit 0
key="cmd-$(shorthash "$cmd")"
[ -e "$cache/$key" ] && exit 0
touch "$cache/$key"

# Raw-cosine floor: without it the top two hits come back even when nothing is related.
out="$(mem_get "/api/recall?q=$(urlencode "$cmd")&type=episode,decision&k=2&min_sim=${MEMORY_BASH_MIN_SIM:-0.7}" 2>/dev/null)" || exit 0
jq -e '.items | length > 0' >/dev/null 2>&1 <<<"$out" || exit 0

# Tighter budget than the file hook: 2 items, 3 lines total.
context="$(jq -r '
  "[memory] Related past work:",
  (.items[] | "- \(.date) · \(.project) · \(.summary)" + (if .ref != "" then " → \(.ref)" else "" end))
' <<<"$out" | cut -c1-240 | head -3)"

[ -z "$context" ] && exit 0

jq -n --arg ctx "$context" '{
  hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx }
}'
exit 0
