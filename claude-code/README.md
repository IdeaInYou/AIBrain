# claude-code/ — client side

Copy this onto every device you use Claude Code from. Nothing here talks to a paid
API: the extraction runs through your own `claude` CLI, inside your subscription.

## Install

```bash
cp -r claude-code/hooks     ~/.claude/
cp -r claude-code/prompts   ~/.claude/
cp -r claude-code/commands  ~/.claude/
cp claude-code/memory.env.example ~/.claude/memory.env
chmod +x ~/.claude/hooks/*.sh
```

Fill in `~/.claude/memory.env`:

```
MEMORY_URL=https://memory.<your-domain>
MEMORY_TOKEN=<the same value as MCP_AUTH_TOKEN on the server>
MEMORY_EXTRACT_MODEL=haiku
```

Merge `settings.hooks.json` into `~/.claude/settings.json` (user scope, so it
applies in every repo). If that file already has a `hooks` key, merge the
`SessionStart` and `Stop` arrays rather than replacing the object.

Register the MCP server once per device:

```bash
claude mcp add --scope user --transport http memory https://memory.<your-domain>/mcp \
  --header "Authorization: Bearer <token>"
```

Requires `jq` and `curl` on PATH.

## What each piece does

| File | Event | Effect |
|---|---|---|
| `hooks/memory-context.sh` | `SessionStart` | Prints the last 30 days of timeline into context. Deterministic — the model cannot forget to load it. |
| `hooks/memory-extract.sh` | `Stop` | Journals the finished session: one episode plus up to 5 durable facts. |
| `commands/memory-log.md` | `/memory-log <text>` | Manual write when a session was interrupted and the hook never fired. |
| `prompts/extract.txt` | — | The extraction prompt. Edit this to change what gets remembered. |
| `hooks/lib.sh` | — | `mem_get` / `mem_post` / `detect_project`. Sourced by both hooks. |

## Behaviour worth knowing

- **Hooks never fail a session.** Every path ends in `exit 0`; `curl` has
  `--max-time`, `claude -p` has `timeout 120`.
- **Extraction runs detached.** The Stop hook returns immediately; the model call
  happens in the background and appends to `~/.claude/memory-extract.log`.
- **Recursion is guarded.** `claude -p` inside the hook would fire the same Stop
  hook again, so the child runs with `MEMORY_HOOK_RUNNING=1` and exits early.
- **Sessions under 400 characters of prose are skipped** — nothing worth journaling.
- **Everything is stored in English.** The prompt translates on the way in; the
  MCP tool descriptions tell Claude to do the same when it writes directly.

## Checking it works

```bash
# 1. Server reachable?
curl -s https://memory.<domain>/health | jq

# 2. Does the timeline render?
source ~/.claude/hooks/lib.sh && mem_get "/api/summary?days=30"

# 3. After a real session, did anything land?
tail -20 ~/.claude/memory-extract.log
```

If `detect_project` keeps guessing wrong, teach the server the mapping once:

```bash
source ~/.claude/hooks/lib.sh
curl -sS -X PUT "$MEMORY_URL/api/projects/getcheckout" \
  -H "Authorization: Bearer $MEMORY_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"GetCheckout","repo_names":["getcheckout-app"],"aliases":["gc"]}'
```
