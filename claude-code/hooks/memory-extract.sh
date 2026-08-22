#!/usr/bin/env bash
# Stop hook — journals the session as one episode plus any durable facts.
# Always exits 0: memory must never be able to break a coding session.
set -uo pipefail
. "$HOME/.claude/hooks/lib.sh"

# `claude -p` below starts a session of its own, which would fire this same Stop
# hook. Without this guard that recurses forever.
[ -n "${MEMORY_HOOK_RUNNING:-}" ] && exit 0

mem_configured || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v claude >/dev/null 2>&1 || exit 0

payload="$(cat)"
transcript="$(jq -r '.transcript_path // empty' <<<"$payload" 2>/dev/null)"
session="$(jq -r '.session_id // empty' <<<"$payload" 2>/dev/null)"

# Claude Code sets this when a Stop hook's own continuation triggered the event.
[ "$(jq -r '.stop_hook_active // false' <<<"$payload" 2>/dev/null)" = "true" ] && exit 0
[ -z "$transcript" ] || [ ! -s "$transcript" ] && exit 0

project="$(detect_project 2>/dev/null || true)"
project="${project:-general}"

# Assistant/user prose only — tool results would blow up the prompt for no gain.
text="$(jq -r 'select(.type=="user" or .type=="assistant") | .message.content
  | if type=="array" then map(select(.type=="text") | .text) | join("\n") else . end' \
  "$transcript" 2>/dev/null | tail -c 120000)"

# Too short to be worth a journal entry.
[ "${#text}" -lt 400 ] && exit 0

# The slow part runs detached so the session ends immediately.
(
  export MEMORY_HOOK_RUNNING=1
  log="$HOME/.claude/memory-extract.log"

  result="$(printf '%s\n\n---TRANSCRIPT---\n%s' \
    "$(cat "$HOME/.claude/prompts/extract.txt")" "$text" \
    | timeout 120 claude -p --output-format json --model "$MEMORY_EXTRACT_MODEL" 2>/dev/null \
    | jq -r '.result // empty' \
    | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')"

  if [ -z "$result" ] || ! jq -e . >/dev/null 2>&1 <<<"$result"; then
    echo "$(date -u +%FT%TZ) extract failed or produced no JSON (session $session)" >>"$log"
    exit 0
  fi

  jq -n --argjson r "$result" --arg p "$project" --arg s "$session" --arg d "$DEVICE" \
    '$r + {project: $p, source: {kind: "hook", client: "claude-code", device: $d, session_id: $s}}' \
    | mem_post /api/ingest >>"$log" 2>&1 || true
  echo "" >>"$log"
) >/dev/null 2>&1 &

exit 0
