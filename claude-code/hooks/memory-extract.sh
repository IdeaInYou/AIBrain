#!/usr/bin/env bash
# Stop hook — journals the session as one episode plus any durable facts, and
# leaves note files behind in the repo. Always exits 0: memory must never be
# able to break a coding session.
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
repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"

# Assistant/user prose only — tool results would blow up the prompt for no gain.
# Harness noise is stripped: system reminders and slash-command wrappers are not
# the session's content, and meta entries are injected context, not dialogue.
# `</transcript>` is removed so the text cannot close its own wrapper.
text="$(jq -r 'select((.type=="user" or .type=="assistant") and (.isMeta != true))
  | .type as $role
  | .message.content
  | (if type=="array" then map(select(.type=="text") | .text) | join("\n") else . end)
  | gsub("<system-reminder>[\\s\\S]*?</system-reminder>"; "")
  | gsub("<(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>[\\s\\S]*?</\\1>"; "")
  | gsub("\\[Request interrupted by user[^\\]]*\\]"; "")
  | gsub("</?transcript>"; "")
  | select(test("\\S"))
  | "[\($role)] \(.)"' \
  "$transcript" 2>/dev/null | tail -c 120000)"

# Too short to be worth a journal entry.
[ "${#text}" -lt 400 ] && exit 0

# The slow part runs detached so the session ends immediately.
(
  export MEMORY_HOOK_RUNNING=1
  log="$HOME/.claude/memory-extract.log"
  say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$log"; }

  brief="$(mem_get /api/projects 2>/dev/null | jq -r --arg p "$project" '.projects[]? | select(.slug == $p) | .brief // ""' 2>/dev/null)"

  result="$(printf '%s\n\n---TRANSCRIPT---\n<transcript>\n%s\n</transcript>\n\nCURRENT PROJECT BRIEF (project: %s):\n%s\n' \
    "$(cat "$HOME/.claude/prompts/extract.txt")" "$text" "$project" "${brief:-(empty)}" \
    | timeout 120 claude -p --no-session-persistence --output-format json --model "$MEMORY_EXTRACT_MODEL" 2>/dev/null \
    | jq -r '.result // empty' \
    | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')"

  if [ -z "$result" ] || ! jq -e . >/dev/null 2>&1 <<<"$result"; then
    say "extract failed or produced no JSON (session $session)"
    exit 0
  fi

  date_str="$(date +%F)"
  short="$(printf '%s' "$session" | tr -d '-' | cut -c1-8)"   # 8 chars: 4 collided too easily
  refs_json='[]'
  note_arg=()

  if [ -n "$repo" ] && [ -f "$HOME/.claude/hooks/render.mjs" ]; then
    sess_rel="docs/memory/sessions/$date_str-$short.md"

    # 1. Decision ADRs first — the session note links to them.
    adr_map='{}'
    refs=("$sess_rel")
    while IFS= read -r d; do
      [ -z "$d" ] && continue
      content="$(jq -r '.content' <<<"$d")"
      slug="$(slugify "$content")"
      adr_rel="docs/memory/decisions/$date_str-$slug.md"
      action="$(jq -n --argjson decision "$d" \
                      --argjson episode "$(jq -c '.episode // {}' <<<"$result")" \
                      --arg date "$date_str" --arg project "$project" \
                      --arg session "$session" --arg sessionRef "$sess_rel" \
                '{decision:$decision, episode:$episode,
                  meta:{date:$date, project:$project, session:$session, sessionRef:$sessionRef}}' \
                | node "$HOME/.claude/hooks/render.mjs" adr "$repo/$adr_rel" 2>>"$log")"
      say "adr $adr_rel -> ${action:-error}"
      refs+=("$adr_rel")
      adr_map="$(jq --arg c "$content" --arg r "$adr_rel" '. + {($c): $r}' <<<"$adr_map")"
    done < <(jq -c '.facts[]? | select(.type=="decision" and (.importance // 0) >= 4)' <<<"$result")

    # 2. Session note.
    jq -n --argjson result "$result" --arg date "$date_str" --arg project "$project" \
          --arg session "$session" --arg device "$DEVICE" --argjson adr "$adr_map" \
      '{result:$result, meta:{date:$date, project:$project, session:$session, device:$device, adrByContent:$adr}}' \
      | node "$HOME/.claude/hooks/render.mjs" session "$repo/$sess_rel" >>"$log" 2>&1

    # 3. architecture.md, patch-mode, lock held inside render.mjs.
    delta="$(jq -c '.architecture_delta // []' <<<"$result")"
    if [ "$delta" != "[]" ]; then
      action="$(jq -n --argjson delta "$delta" --arg date "$date_str" --arg short "$short" \
                  '{delta:$delta, meta:{date:$date, short:$short}}' \
                | node "$HOME/.claude/hooks/render.mjs" arch "$repo/docs/memory/architecture.md" 2>>"$log")"
      say "architecture.md -> ${action:-error}"
    fi

    refs_json="$(printf '%s\n' "${refs[@]}" | jq -R . | jq -sc .)"
    [ -f "$repo/$sess_rel" ] && note_arg=(--rawfile note "$repo/$sess_rel")
  fi

  # 4. Server: episode + facts, carrying refs and the full note.
  # `$note` is a compile-time binding in jq, so the two shapes have to be
  # separate invocations — try/catch cannot rescue an undefined variable.
  base_filter='$r + {project: $p, refs: $refs,
           source: {kind: "hook", client: "claude-code", device: $d, session_id: $s}}'
  if [ ${#note_arg[@]} -gt 0 ]; then
    ingest_body="$(jq -n --argjson r "$result" --arg p "$project" --arg s "$session" \
      --arg d "$DEVICE" --argjson refs "$refs_json" "${note_arg[@]}" \
      "$base_filter + {note: \$note}")"
  else
    ingest_body="$(jq -n --argjson r "$result" --arg p "$project" --arg s "$session" \
      --arg d "$DEVICE" --argjson refs "$refs_json" "$base_filter")"
  fi
  printf '%s' "$ingest_body" | mem_post /api/ingest >>"$log" 2>&1 || true
  printf '\n' >>"$log"

  # 5. Commit the notes — but never while the repo is mid-operation.
  if [ -n "$repo" ] && [ -d "$repo/docs/memory" ]; then
    if git_busy "$repo"; then
      say "commit skipped: repo busy or detached HEAD ($repo)"
      note_pending_commit "$repo"
    else
      git -C "$repo" add docs/memory 2>>"$log"
      if git -C "$repo" diff --cached --quiet -- docs/memory 2>/dev/null; then
        say "nothing to commit"
      else
        git -C "$repo" commit -q -m "memory: session $date_str-$short" -- docs/memory 2>>"$log" \
          && say "committed docs/memory" || say "commit failed"
      fi
    fi
  fi
) >/dev/null 2>&1 &

exit 0
