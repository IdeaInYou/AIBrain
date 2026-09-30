# Claude Memory MCP

Long-term memory for Claude: an MCP server on Node/TypeScript over OpenSearch, self-hosted, reachable from every device — claude.ai web and mobile, Claude Desktop, Claude Code. Single user, no paid APIs.

The goal is that a month from now Claude remembers **what we did and why**. This is not a complete knowledge base about your projects; it is a journal of work sessions plus the decisions that came out of them.

---

## 1. Principles

- **The episode is the unit.** One work session becomes one note: what was done, why, the outcome, what was deferred. Written automatically by a `Stop` hook — it does not depend on the model choosing to remember.
- **Facts are secondary.** Zero to five decisions or preferences per session, if there were any. No attempt to extract everything.
- **English-only storage.** The hook and the tool descriptions translate on the way in. The server knows nothing about other languages.
- **Recency beats importance** for episodes; decisions do not decay at all.
- **The server does not think.** It stores and searches. No LLM call anywhere in it — no `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, or `OPENAI_API_KEY`. Embeddings run locally as an ONNX model in the same process.
- **LLM work happens only in Claude Code** on your own machines, inside your subscription, through hooks and slash commands.
- **Summaries are templates, not generated prose.**
- **Claude never starts from nothing** — `memory_summary` with no arguments at the start of every conversation.
- **Notes live in the repo too.** Each session leaves a markdown file under `docs/memory/`, and the memory record links to it.

---

## 2. Stack

| Layer | Technology |
|---|---|
| Runtime | Node 22, TypeScript, ESM |
| MCP | `@modelcontextprotocol/server` v2, Streamable HTTP (stdio for dev only) |
| HTTP | Hono + `@hono/node-server` |
| Search | OpenSearch 2.x, `k-NN` + `neural-search` (hybrid query), `english` analyzer |
| Embeddings | `@huggingface/transformers` (ONNX, CPU), `BAAI/bge-base-en-v1.5`, 768 dim |
| Validation | zod v4 |
| Logging | pino |
| Auth | Bearer token, plus OAuth 2.1 for claude.ai web/mobile |
| Deploy | Docker Compose, Traefik v3, GitHub Actions on a self-hosted runner |
| Client | bash + the `claude` CLI, in `~/.claude/` |

VPS: 2 vCPU / 4 GB. OpenSearch 1 GB heap, Node ~500 MB with the model loaded.

---

## 3. Quick start

### Server

```bash
cp .env.example .env          # set MCP_AUTH_TOKEN=$(openssl rand -hex 32)
                              # set PUBLIC_URL to enable OAuth (needed for web/mobile)
docker compose up -d          # first boot downloads ~450 MB of model into the model-cache volume
curl -s localhost:3000/health | jq
```

Local development without Docker:

```bash
npm install
npm run dev                   # tsx watch, HTTP
npm run dev:stdio             # stdio — for MCP Inspector
npm test
```

Indices and the search pipeline are created automatically at boot. `npm run init-index` exists for running that step alone.

### Claude Code

See [claude-code/README.md](claude-code/README.md). In short:

```bash
cp -r claude-code/{hooks,prompts,commands} ~/.claude/
cp claude-code/memory.env.example ~/.claude/memory.env   # fill in MEMORY_URL, MEMORY_TOKEN
chmod +x ~/.claude/hooks/*.sh

# merge claude-code/settings.hooks.json into ~/.claude/settings.json
claude mcp add --scope user --transport http memory https://memory.<domain>/mcp \
  --header "Authorization: Bearer <token>"

# per repo, optional: send commits to memory as well
claude-code/git/install-hook.sh
```

Paste the block from [claude-code/CLAUDE.memory.md](claude-code/CLAUDE.memory.md) into each repo's `CLAUDE.md`. It is reinforcement, not the mechanism — nothing breaks without it.

### claude.ai and Claude Desktop

Customize → Connectors → Add custom connector → `https://memory.<domain>/mcp` → Connect. Leave the OAuth Client ID and Secret fields empty; the server supports dynamic client registration and issues its own. The consent screen asks for `OAUTH_PASSWORD` (defaults to `MCP_AUTH_TOKEN`). See §10.

There are no hooks on those surfaces, so memories are written through `memory_remember` during conversation — the tool descriptions push Claude to do that unprompted.

---

## 4. Repository layout

```
├── docker-compose.yml            # local / single-host
├── deploy/docker-compose.yml     # server-side: pulls the built image
├── Dockerfile
├── .github/workflows/            # build → push → deploy over SSH
├── src/
│   ├── index.ts                  # warm embedder → init indices → serve
│   ├── config.ts                 # env → typed config (zod), INDEX, LIMITS, OAUTH
│   ├── logger.ts                 # pino; writes to stderr under stdio transport
│   ├── types.ts
│   ├── mcp/
│   │   ├── server.ts             # McpServer + instructions
│   │   ├── instructions.ts       # SERVER_INSTRUCTIONS, pinned by a test
│   │   ├── tools/{summary,recall,remember,update,forget}.ts
│   │   ├── resources.ts          # memory://summary | projects | notes/{id} | preferences
│   │   └── prompts.ts            # start_session
│   ├── search/
│   │   ├── client.ts             # OpenSearch client, osRequest, osExists
│   │   ├── indices.ts            # mappings + search pipeline
│   │   ├── hybrid.ts             # hybrid query, RRF fallback, knn, listMemories
│   │   ├── dedupe.ts             # normalize, hash, cosine, near-duplicate
│   │   └── rerank.ts             # per-type decay
│   ├── embed/{embedder,local}.ts # interface + singleton; transformers.js, bge
│   ├── core/
│   │   ├── remember.ts           # the single write path: MCP + REST
│   │   ├── memory.ts             # recall, update, forget, queries
│   │   ├── summary.ts            # template chronology
│   │   ├── ingest.ts             # episode + facts in one call
│   │   ├── commits.ts            # git commits → attach or create
│   │   ├── related.ts            # bidirectional links between memories
│   │   ├── fileContext.ts        # "why did this file change before?"
│   │   ├── events.ts             # usage metrics + /api/stats aggregation
│   │   └── projects.ts           # project registry, aliases, repo_names
│   ├── oauth/{service,store}.ts  # PKCE, DCR, token rotation, OpenSearch-backed
│   └── http/
│       ├── app.ts                # Hono, dual-credential auth middleware
│       └── routes/{mcp,ingest,summary,projects,file-context,stats,oauth,health}.ts
├── scripts/
│   ├── init-index.ts
│   ├── reindex.ts                # after changing the embedding model
│   ├── migrate-episodes.ts       # one-off: collapse pre-dedupe episode duplicates
│   └── backup.sh                 # OpenSearch snapshots
├── claude-code/                  # copied to ~/.claude/ on each device
│   ├── README.md
│   ├── CLAUDE.memory.md          # block to paste into each repo's CLAUDE.md
│   ├── memory.env.example
│   ├── settings.hooks.json
│   ├── hooks/{lib.sh, memory-context.sh, memory-extract.sh,
│   │          memory-pretool.sh, memory-pretool-bash.sh, render.mjs}
│   ├── git/{post-commit, install-hook.sh}
│   ├── commands/memory-log.md
│   └── prompts/extract.txt
├── docs/archive/                 # superseded design documents
└── test/
```

---

## 5. Data

### 5.1 `memories`

```jsonc
{
  "settings": { "index": { "knn": true, "number_of_shards": 1, "number_of_replicas": 0 } },
  "mappings": { "properties": {
    "content":       { "type": "text", "analyzer": "english" },
    "embedding":     { "type": "knn_vector", "dimension": 768,
                       "method": { "name": "hnsw", "space_type": "cosinesimil", "engine": "lucene",
                                   "parameters": { "ef_construction": 128, "m": 16 } } },
    "type":          { "type": "keyword" },   // episode | decision | preference | todo | fact
    "project":       { "type": "keyword" },
    "tags":          { "type": "keyword" },
    "importance":    { "type": "byte" },      // 1..5, default 3
    "status":        { "type": "keyword" },   // active | superseded | done | deleted
    "superseded_by": { "type": "keyword" },
    "episode":       { "type": "object", "properties": {   // type=episode only
        "did": {...}, "why": {...}, "outcome": {...}, "deferred": {...},
        "files":   { "type": "keyword" },
        "commits": { "sha": "keyword", "message": "text" } }},
    "source":        { "type": "object", "properties": {
        "kind":       { "type": "keyword" },  // hook | tool | command | git
        "client":     { "type": "keyword" },  // claude-code | claude-ai | claude-desktop | git
        "device":     { "type": "keyword" },
        "session_id": { "type": "keyword" } }},
    "related":       { "type": "keyword" },   // ids of neighbouring memories, symmetric
    "refs":          { "type": "keyword" },   // repo-relative note paths
    "note":          { "type": "text", "index": false },  // full markdown, retrievable not searchable
    "occurred_at":   { "type": "date" },      // when the work happened — drives recency
    "created_at":    { "type": "date" },
    "content_hash":  { "type": "keyword" }
  }}
}
```

For an episode, `content` is `did + why + outcome + deferred` concatenated for search; the structured fields are for display.

### 5.2 `projects`

`slug`, `name`, `repo_names[]`, `aliases[]`, `last_activity`. Created on first write to a project; `last_activity` only ever moves forward. Teach it your git remotes once and `detect_project` stops guessing:

```bash
curl -X PUT "$MEMORY_URL/api/projects/open-chance" \
  -H "Authorization: Bearer $MEMORY_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Open Chance","repo_names":["OpenChance"],"aliases":["openchance"]}'
```

### 5.3 `oauth` and `events`

`oauth` holds registered clients, authorization codes, and tokens — all secrets stored as SHA-256 hashes, in OpenSearch rather than memory so a redeploy does not sign every device out.

`events` holds usage metrics: `ts, kind, client, project, source_kind, k, hits, latency_ms, query_len, top_score, cached`. **No memory content ever lands there.**

There is no `summaries` or `sessions` index: summaries are templates, and transcripts stay on the device.

---

## 6. MCP interface

The server is **self-describing**: all behavioural guidance lives in `instructions` and the tool descriptions, so it behaves the same in claude.ai, Claude Desktop, and Claude Code with no client-side configuration.

### 6.1 Why that works

Every MCP client passes Claude the server `instructions` from `initialize`, each tool's `name`, `description`, and JSON schema, and the resource and prompt listings. There is no trigger engine — Claude decides to call a tool by reading those. Therefore:

- Descriptions are written as **triggers** ("ALWAYS call before X"), not features ("allows searching").
- The first tool Claude should call takes **no required arguments**, so there is no reason to hesitate.
- `instructions` repeats the same rules for clients that honour it.

### 6.2 Server instructions

Kept as a single constant in [src/mcp/instructions.ts](src/mcp/instructions.ts) so a test can pin it against drift:

```text
This server is the user's long-term memory across all their projects and conversations. …

Use it proactively, without being asked:
1. At the start of every conversation, call memory_summary with no arguments …
2. Before answering anything about the user's projects … call memory_recall …
3. Whenever the user states a decision, a preference, a durable fact … call memory_remember immediately.
4. If memory_recall returns nothing relevant, say so explicitly rather than guessing.

Never assume you remember something this server did not return.

Memory is stored in English. …
```

The server is named `memory`, so tools render as `memory_*` and the prefix documents itself.

### 6.3 Tools

| Tool | Role |
|---|---|
| `memory_summary` | **Entry point.** No required arguments (`project?`, `days?`). Returns the template chronology. |
| `memory_recall` | Search. Query must be in English — the tool tells Claude to translate. Supports `since`/`until`. |
| `memory_remember` | Write. `content` in English; `type=episode` takes a structured `episode` object; `refs`/`note` link repo files. |
| `memory_update` | Amend by id; `status: "done"` closes a todo. The new version is `locked`: automatic dedupe and `merge-duplicates` never supersede it. |
| `memory_forget` | **Permanent** delete by id or filter — no undo. |

Every description is capped at 400 characters, enforced by a test.

`memory_summary` returns:

```markdown
## Last 30 days
- 2026-08-22 · aibrain · Deployed the memory server behind Traefik. → docs/memory/sessions/2026-08-22-a1b2c3d4.md

## Earlier (by month)
### 2026-07
- 2026-07-14 · getcheckout · Rejected Klarna for the UA market.

## Milestones (importance ≥ 4)
- 2026-08-20 · aibrain · Chose MCP SDK v2 over v1.

## Open todos
- [aibrain] Rotate the auth token before the first push.

## Preferences
- Answer in the language the user writes in; keep replies concise.

Call memory_recall for details on any item.
```

`days` bounds the **Recent block only** — older work stays visible under "Earlier", grouped by month, so nothing silently ages out of the overview. The closing line is deliberate: it prompts the follow-up `memory_recall`.

### 6.4 Resources and prompt

| URI | Description |
|---|---|
| `memory://summary` | Cross-project overview. **Static**, so clients that auto-attach resources can surface it. |
| `memory://projects` | Project list. |
| `memory://projects/{project}/summary` | One project's chronology. |
| `memory://notes/{id}` | Full markdown of a session or decision note — how web and mobile read details without the repo. |
| `memory://preferences` | How the user prefers to work. |

The `start_session` prompt (rendered as a slash command in Claude Code) returns the summary plus the §6.2 rules verbatim.

### 6.5 Wording rules

Do: lead with the trigger ("ALWAYS call…", "REQUIRED before…", "Call IMMEDIATELY when…"); pre-empt the reason to skip ("even if you believe you already know the answer"); state what happens without the call; say "Omit if unsure" for optional arguments; stay under 400 characters.

Don't: "allows you to", "can be used to", "helps with" — passive and ignored. Don't describe implementation. Don't repeat a rule in more than two places.

---

## 7. Search, ranking, dedupe

**Hybrid query** — BM25 and k-NN in one request through the `hybrid-rrf` search pipeline (min-max normalization, weights 0.4 / 0.6). The k-NN filter goes **inside** the `knn` clause; wrapping it in a `bool` filter would post-filter and silently return fewer than `k` hits. If the `hybrid` clause is unavailable, the server falls back once per process to two queries fused with RRF in Node.

**Rerank in Node**, by `occurred_at`:

```
episode:            score × max(0.5, exp(-ageDays / 365))
decision | fact:    score × (1 + (importance - 3) × 0.1)      — no decay
todo:               score × 1.2  when status is active
preference:         score                                      — never decays
```

The episode floor matters: `exp(-age/365)` crosses 0.5 at about 253 days, so everything older ranks the same on recency rather than fading to irrelevance.

**Dedupe** applies to `decision | preference | todo | fact` only. Exact `content_hash` match updates metadata in place; otherwise a k-NN top-5 within the same project and type, with cosine ≥ `DEDUPE_THRESHOLD`, supersedes the older record. Cosine is recomputed in Node from the stored vector rather than read off `_score`, whose scale depends on the k-NN engine.

**Episodes dedupe on `source.session_id` instead.** The `Stop` hook fires more than once per session, and one session is one journal entry, so a later write updates the first rather than adding to it.

---

## 8. Notes in the repo

Every session leaves files behind, written by the hook rather than the model — so they appear whether or not Claude thought to create them.

| Path | Written when |
|---|---|
| `docs/memory/sessions/<date>-<short>.md` | every session, overwritten by repeat `Stop` hooks |
| `docs/memory/decisions/<date>-<slug>.md` | a decision with `importance ≥ 4` was extracted |
| `docs/memory/architecture.md` | the extraction reported an `architecture_delta` |

The memory record carries `refs` (the paths) and `note` (the full markdown), so claude.ai and mobile can read the detail through `memory://notes/{id}` without the repo.

**ADRs are not blindly overwritten.** The frontmatter carries `generated: true`. If the file is still untouched, a repeat `Stop` regenerates it. If you edited it — removed `generated`, or changed `status` — the hook leaves your text alone and appends a `## Revision <date>` section instead, so the divergence is visible rather than resolved silently in either direction.

**`architecture.md` is patched, never rewritten.** Managed lines live inside `<!-- memory:begin Section -->` / `<!-- memory:end Section -->` markers and each carries an explicit key:

```markdown
## Modules
<!-- memory:begin Modules -->
- src/core/remember.ts — dedupe and supersede, shared by MCP and REST <!-- k:src/core/remember.ts -->
<!-- memory:end Modules -->
```

Matching is on the `k:` marker, never on parsing the prose. Free text outside the blocks is yours and is never touched. Concurrent sessions are serialized by a lock implemented in `render.mjs` — `flock` does not exist on macOS, so the lock uses `O_EXCL` with a 60-second stale escape, portable across devices.

**Commits are guarded.** The hook commits only `docs/memory`, and skips entirely when the repo is mid-rebase, mid-merge, mid-cherry-pick, or on a detached HEAD. It still writes the files and records the repo in `~/.claude/memory-pending-commits.log`; the next `SessionStart` there commits them once the repo is calm.

---

## 9. Context at the moment of action

**Pre-tool recall.** Before Claude edits a file, a `PreToolUse` hook injects that file's history:

```
[memory] Earlier work on src/core/remember.ts:
- 2026-08-21 · Added session-scoped dedupe for episodes. — because: The Stop hook fired several times per session. → docs/memory/sessions/2026-08-21-aabbccdd.md
```

Backed by `GET /api/file-context`, which ranks in three tiers — the exact file (from `episode.files` or `refs`), a decision that names it, then other work in the same directory. One lookup per file per session, at most four lines.

`PreToolUse` **ignores plain stdout**, unlike `SessionStart` — context only reaches the model through `hookSpecificOutput.additionalContext`, so the hook emits JSON.

A second hook does the same for `Bash` commands matching `docker compose|traefik|deploy|migrat|reindex|opensearch|certbot|systemctl`, catching "last time this broke because…". Deliberately narrow: firing on every `ls` would be pure noise.

**Git as a second source.** A `post-commit` hook posts each commit to `/api/ingest/commit`. A commit made during a session attaches to that session's episode — the episode says why, the commits say what exactly. Outside a two-hour window it becomes a light episode of its own, which is how work done without Claude Code still reaches memory. Deduped on sha, so amends and rebases do not double-count.

**Related links.** Every write finds up to five neighbours across all types in the project at cosine ≥ `RELATED_THRESHOLD` (looser than dedupe: "about the same thing", not "the same thing") and links them symmetrically. Recall attaches `see_also` to the top three hits.

---

## 10. OAuth

A static bearer token only works where you can configure it locally — Claude Code and `mcp-remote`. **claude.ai web and mobile reach the server from Anthropic's cloud** (egress `160.79.104.0/21`) and cannot carry a local header, so the server runs its own OAuth 2.1.

Set `PUBLIC_URL` to enable it; without it the server stays static-bearer only and logs a warning at boot.

- **Dynamic client registration** (RFC 7591), so nothing needs entering in the connector dialog.
- **PKCE S256 required.** Authorization codes are single-use with a 60-second TTL.
- **Refresh tokens rotate** on every use and burn on replay, as required for public clients. Errors use RFC 6749 codes — Claude keys its refresh logic on `invalid_grant`.
- **The consent screen** asks for `OAUTH_PASSWORD` (defaults to `MCP_AUTH_TOKEN`), locked out for 15 minutes after five failures.
- **Both credentials work in parallel.** The middleware accepts the static token (hooks, REST) and OAuth access tokens (connectors). Dropping the static one would break every installed hook.
- **`redirect_uri` matches exactly**, except loopback: Claude Code binds an ephemeral port under RFC 8252, so the port is ignored for `localhost` and `127.0.0.1` and nothing else. That check is what closes the open-redirect hole, and it is the most heavily tested function in the suite.
- **401 responses carry `WWW-Authenticate: Bearer resource_metadata="…"`** — without it an MCP client never discovers that OAuth exists.

---

## 11. REST API

Bearer token or OAuth access token on everything except `/health` and the OAuth endpoints.

| Method | Path | Purpose |
|---|---|---|
| `POST\|GET\|DELETE` | `/mcp` | Streamable HTTP MCP transport |
| `POST` | `/api/ingest` | `{episode?, facts?, project?, refs?, note?, project_brief?, source?}` from the `Stop` hook; a non-empty `project_brief` replaces the project's brief |
| `POST` | `/api/ingest/commit` | git `post-commit`; attaches to an episode or creates one |
| `GET` | `/api/summary?project=&days=` | same text as `memory_summary`, as markdown, for `SessionStart` |
| `GET` | `/api/file-context?path=&k=` | file history for the pre-tool hook |
| `GET` | `/api/recall?q=&type=&k=&min_sim=` | search for the Bash hook; `min_sim` drops hits whose raw query↔record cosine is below it (hybrid scores are normalised per query, so they cannot say "nothing relevant") |
| `GET` | `/api/projects` | project list with `last_activity` |
| `PUT` | `/api/projects/:slug` | `{name?, aliases?, repo_names?, brief?}` — teach it your git remotes; `brief` (≤ 1500 chars) heads that project's summary |
| `GET` | `/api/stats?days=` | usage metrics and warnings |
| `GET` | `/api/digest?period=daily\|weekly&project=&format=md\|json` | rolling 24 h / 7 d window by `occurred_at` |
| `POST` | `/api/imports` | `{records: [...]}` or an NDJSON body, ≤ 500 records; each goes through `remember()` (dedupe, links, deferred→todo) |
| `POST` | `/api/maintenance/merge-duplicates` | `{project?, threshold?=0.95, limit?=500, apply?}` — dry run unless `apply: true`; same project + type only, never episodes; never drops a `locked` record |
| `POST` | `/api/maintenance/dedupe-episodes` | `{project?, apply?}` — collapse pre-session-dedupe episode duplicates; dry run by default |
| `GET` | `/api/maintenance/similar?threshold=&type=&project=` | pairwise cosine audit for calibrating thresholds |
| `GET` | `/health` | no auth; OpenSearch plus embedder readiness |
| — | `/.well-known/oauth-*`, `/oauth/*` | no auth; discovery, registration, authorize, token, revoke |

Bodies must already be English — the server never translates.

---

## 12. Claude Code client

Full instructions in [claude-code/README.md](claude-code/README.md).

| File | Event | Effect |
|---|---|---|
| `hooks/memory-context.sh` | `SessionStart` | Prints the chronology into context, plus paths to the architecture map and recent ADRs. Commits any notes a previous session could not. |
| `hooks/memory-pretool.sh` | `PreToolUse` (Edit/Write/MultiEdit) | Injects that file's history before the edit. |
| `hooks/memory-pretool-bash.sh` | `PreToolUse` (Bash) | Same for deploy-shaped commands. |
| `hooks/memory-extract.sh` | `Stop` | Journals the session, writes note files, patches the architecture map, commits. |
| `git/post-commit` | git | Sends commits to memory. |
| `commands/memory-log.md` | `/memory-log <text>` | Manual write when a session was interrupted. |
| `prompts/extract.txt` | — | The extraction prompt. Edit this to change what gets remembered. |
| `hooks/render.mjs` | — | Renders notes and patches `architecture.md`. |

Three things that are easy to break and hard to notice:

- **Recursion.** `claude -p` inside the `Stop` hook starts a session that fires the same hook. The child runs with `MEMORY_HOOK_RUNNING=1` and exits immediately.
- **Hooks never fail a session.** Every path ends in `exit 0`; `curl` has `--max-time`, `claude -p` has `timeout 120`.
- **Extraction runs detached** — the hook returns immediately and logs to `~/.claude/memory-extract.log`. It runs with `--no-session-persistence`, so extraction sessions never show up in `/resume`.
- **The transcript is data.** System reminders, slash-command wrappers and meta entries are stripped, and the rest is wrapped in `<transcript>` so the model summarizes it instead of answering it. The current project brief is passed in; the model returns a rewritten one only when something durable changed.
- **Model.** `MEMORY_EXTRACT_MODEL` defaults to `sonnet`: on the same transcript Haiku ignored the brief format and invented figures, Sonnet did not.

Sessions with under 400 characters of prose are not journaled.

Requires `jq`, `curl`, and `node` on `PATH`.

---

## 13. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | `trace`…`fatal`, `silent` |
| `MCP_TRANSPORT` | `http` | `stdio` for MCP Inspector only |
| `MCP_AUTH_TOKEN` | — | required for `http`; `openssl rand -hex 32` |
| `OPENSEARCH_URL` | `http://localhost:9200` | |
| `INDEX_PREFIX` | empty | lets several deployments share one cluster |
| `EMBED_MODEL` | `BAAI/bge-base-en-v1.5` | |
| `EMBED_DIM` | `768` | must match the model; checked at boot |
| `EMBED_DTYPE` | `fp32` | `q8` uses a quarter of the memory, at some recall cost |
| `MODEL_CACHE_DIR` | `/models` | volume, so the model downloads once |
| `DEDUPE_THRESHOLD` | `0.90` | cosine above which a new fact supersedes an old one |
| `RELATED_THRESHOLD` | `0.75` | cosine for `related` links |
| `RELATED_MAX` | `5` | neighbours linked per write |
| `SUMMARY_DAYS` | `30` | depth of the Recent block |
| `SUMMARY_MAX_EPISODES` | `15` | lines in the Recent block |
| `RECALL_DEFAULT_K` | `8` | |
| `DEFAULT_PROJECT` | `general` | when the project cannot be determined |
| `METRICS_ENABLED` | `true` | the `events` index; no content is stored |
| `PUBLIC_URL` | unset | external origin; **setting it enables OAuth** |
| `OAUTH_PASSWORD` | `MCP_AUTH_TOKEN` | consent screen password |
| `OAUTH_ACCESS_TTL` | `3600` | seconds |
| `OAUTH_REFRESH_TTL` | `2592000` | seconds (30 days) |

Hard limits in code (`config.ts` → `LIMITS`): `content` ≤ 2000 characters, `note` ≤ 20 000, `refs` ≤ 20, `recall.k` ≤ 30, `/api/ingest` body ≤ 2 MB and ≤ 500 facts, episodes under 40 characters skipped.

---

## 14. Operations

**Changing the embedding model** means `npm run reindex`. It recomputes every vector into `memories-v<timestamp>` and prints the alias swap; it deletes nothing. Old vectors are incompatible with a new model — without a reindex, search degrades silently rather than failing.

**`npx tsx scripts/migrate-episodes.ts --dry-run`** collapses episode duplicates written before session-scoped dedupe existed, keeping the newest per `session_id` and splitting `deferred` into real todos. Episodes with no `session_id` are left alone.

**Backups**: `scripts/backup.sh --register` once, then `scripts/backup.sh` nightly from cron. Snapshots into a volume, keeps the last 14.

**Logs**: pino JSON. Memory content is redacted at `info` — only ids and counters.

**Tests**: `npm test`. Covers dedupe normalization, rerank curves, summary formatting, the OAuth PKCE and redirect rules, `related` selection, the OpenSearch HEAD-404 contract, and a snapshot of every tool description so a reworded description is a deliberate diff.

**Recall quality**: `MEMORY_URL=… MEMORY_TOKEN=… npm run eval` runs the paraphrased questions in `eval/recall-cases.json` against the live server and prints hit@1/3/5 and MRR@10. Run it before and after any change to search, ranking or thresholds. Baseline on 2026-09-30: hit@1 82%, hit@3 100%, MRR 0.902 over 22 cases.

**Watching whether it works**: `GET /api/stats?days=7`. The number that matters most is `zero_result_pct` — above 30% means recall is failing, and the cause is usually query wording or missing data rather than ranking.

**Token rotation**: replace `MCP_AUTH_TOKEN` in the server `.env`, in `~/.claude/memory.env` on every device, in `~/.claude.json`, and in any connector. OAuth exists partly to make this rarer.

---

## 15. Fixed decisions

- **No paid APIs.** If `bge-base` proves insufficient, the next step is `bge-large-en-v1.5` (1024 dim, needs a reindex), not a hosted embedding service.
- **English-only storage.** Translation is the responsibility of the hook prompt and the tool descriptions.
- **One episode per session**, keyed on `session_id`. Repeat `Stop` hooks update rather than append.
- **Deferred work becomes a real todo**, so it can appear under Open todos and be closed. It closes automatically when a later `Stop` in the same session no longer defers it.
- **Summaries are templates.** No LLM rebuild.
- **Single user.** No `owner` field. Adding one would need a reindex.
- **stdio is development only.** Production is Streamable HTTP.
- **The model never writes note files.** It records decisions in memory; the hook creates the files deterministically afterwards. That is what stops the two racing.

---

## 16. Deviations from the design documents

Three places where the implementation deliberately differs from the specifications in [docs/archive/](docs/archive/):

1. **MCP SDK v2** (`@modelcontextprotocol/server`), not v1 `@modelcontextprotocol/sdk`. v2 provides `WebStandardStreamableHTTPServerTransport`, which takes `c.req.raw` directly, so Hono needs no adapter. Tools register through `registerTool(name, {description, inputSchema}, cb)`.
2. **`memory_detect_project` was not implemented.** It appears in the self-describing spec §4.4, but the v3 document dropped it from both the file tree and §5. Project detection happens in `lib.sh` against `GET /api/projects` — no model involved, like the rest of the hook.
3. **`memory_remember`'s description is shortened.** The verbatim spec text plus the English-translation sentence came to 421 characters against the 400-character cap. The imperative half is kept word for word; the guidance about `refs` moved onto the parameter description instead.

---

## 17. Not built yet

From the design documents, in the order they are worth doing:

- **Reranker** (`bge-reranker-base`) and **chunked note search**. Both gated on `free -m` showing at least 800 MB spare after OpenSearch and the embedder are warm — and on `/api/stats` showing that ranking, rather than missing data, is the problem.
- **Digest delivery** (Telegram) — the digest itself is `/api/digest`. A **scheduled self-healing** pass (episodes without refs, todos older than 60 days, contradictory decisions, `general` overflow) — today only the manual `merge-duplicates` exists.
- **claude.ai chat import** from an account export.
- **Calendar and Gmail** ingestion as a separate worker.
