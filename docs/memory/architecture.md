# Architecture

<!-- Free text above and outside the marked blocks is yours; the hook never touches it. -->

## Modules
<!-- memory:begin Modules -->
- Bidirectional kNN linking on write; top 5 neighbours at cosine ≥ 0.75 across all types in project. <!-- k:src/core/related.ts -->
- File-context lookup for pre-tool recall, three-tier ranking: exact file, mention in content, directory peer. <!-- k:src/core/fileContext.ts -->
- Git commit ingestion via post-commit hook; attaches to active episode or creates lightweight episode. <!-- k:src/core/commits.ts -->
- Metrics collection for recall (queries, zero results, latency), writes by source_kind, pre-tool hit rate. <!-- k:src/core/events.ts -->
- OAuth 2.0 PKCE public client: DCR, authorization flow, token exchange, refresh rotation, password throttle. <!-- k:src/oauth/service.ts -->
- OpenSearch-backed OAuth state: hashed secrets, 1h access + 7d refresh, family revocation on reuse. <!-- k:src/oauth/store.ts -->
- DCR clients, authorization codes, tokens, refresh families for multi-surface auth. <!-- k:oauth -->
- Query metrics (kind, client, project, latency, top score, cached flag), write events by source. <!-- k:events -->
- Pre-tool recall by file path; three tiers (exact, mention, directory), 60s server cache, 240 chars/line max. <!-- k:GET /api/file-context -->
- Recall quality metrics (zero-result %, p50/p95 latency, top score) and write sources; emits warnings. <!-- k:GET /api/stats -->
- Git commit ingestion; idempotent on sha; attaches to episode or creates standalone. <!-- k:POST /api/ingest/commit -->
- /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server, /oauth/register, /authorize (consent), /token, /revoke. <!-- k:OAuth endpoints -->
- Now accepts OAuth tokens OR static bearer; returns WWW-Authenticate header for clients to detect OAuth support. <!-- k:GET /mcp -->
- OAuth service (DCR, PKCE S256, token storage) and HTTP routes for single-user register-authorize-token-revoke flow <!-- k:src/oauth/ -->
- Episodes now dedupe on source.session_id (one per session, updates not creates); deferred field auto-creates type=todo with same session_id <!-- k:src/core/remember.ts -->
- Discovery docs, /register DCR, /authorize consent, /token code↔bearer, /revoke family-revocation <!-- k:src/http/routes/oauth.ts -->
- Added fields: refs (keyword, ADR paths), related (keyword, bidirectional link ids), note (text, index:false), episode.commits (object with sha/message) <!-- k:memories mapping -->
- Contextum bridge: contextum_search tool queries .contextum/agents, .contextum/coord/tasks.json, .contextum/context.yaml for coordination state <!-- k:src/core/contextum.ts -->
- New tool that queries coordination center state by root path and type (tasks, agents, status, search) <!-- k:src/mcp/tools/contextum.ts -->
- Session end hook extracts episode and facts via claude -p, renders notes and ADRs, patches architecture.md, commits under flock <!-- k:claude-code/hooks/memory-stop.sh -->
- PreToolUse hook on Edit/Write/MultiEdit; emits JSON additionalContext with file history via /api/file-context <!-- k:claude-code/hooks/memory-pretool.sh -->
- PreToolUse hook on Bash, filtered to docker/traefik/deploy/migrate/opensearch; emits JSON additionalContext with relevant history <!-- k:claude-code/hooks/memory-pretool-bash.sh -->
- Semantic reranking via bge-reranker-base (gated on >30% zero-result); composes with type-aware rerank <!-- k:src/core/rerank.ts -->
- Digest window now computed from occurred_at (rolling 24h/7d), errors no longer swallowed as empty results <!-- k:src/core/digest.ts -->
- Auto-detection and merge of duplicates (cosine ≥0.95) via scheduled tasks with cascade supersede <!-- k:src/core/selfHealing.ts -->
- Rewritten to go through the normal remember() pipeline (correct embedding prefix, dedup, related-links, deferred→todo) instead of a separate broken path <!-- k:src/core/imports.ts -->
- Semantic reranking with bge-reranker-base model; RRF fusion of BM25 + kNN scores; activated on >30% zero-result <!-- k:src/core/reranker.ts -->
- Auto-detect duplicates (cosine >0.95); merge + supersede without manual; background task <!-- k:src/core/selfHeal.ts -->
- Semantic reranker with bge-reranker-base foundation, auto-activated when zero-result-pct >30%. <!-- k:src/http/routes/rerank.ts -->
- Daily/weekly summary generation with highlights: top facts, decisions, todos, episodes by date and project. <!-- k:src/http/routes/digest.ts -->
- Background task that finds duplicate records (cosine >0.95), merges them, and supersedes old versions without human intervention. <!-- k:src/http/routes/self-healing.ts -->
- Bulk memory import from NDJSON or CSV with auto-embedding and deduplication. <!-- k:src/http/routes/import.ts -->
- Replaced automatic nightly merge with POST /api/maintenance/merge-duplicates: dry-run by default, cosine 0.95 threshold, same project/type only, episodes excluded, apply:true required to change data <!-- k:src/core/self-healing.ts -->
- memory_remember now checks for near-duplicate/subsumed records before writing and returns a `similar` field so the caller can choose to update instead of creating a new record <!-- k:remember.ts -->
- Stop hook extraction prompt rewritten to scrub hook-inserted memory from the transcript, avoid re-recording already-saved memories, forbid fabricated numbers, and capture dead ends separately <!-- k:memory-extract.sh -->
- Server now generates and stores a short per-project brief, updated by the Stop hook only on material change, surfaced at session start <!-- k:project briefs -->
- New npm run eval command runs a 22-query recall benchmark reporting hit@1, hit@3, and MRR <!-- k:eval harness -->
- Server-side per-project brief updated by the Stop hook only on significant change, merged into remember() and shown at SessionStart <!-- k:Project briefs -->
- Per-project brief maintained by the Stop hook, surfaced at SessionStart alongside recent episodes and todos <!-- k:project brief -->
- npm run eval: 22-query recall quality benchmark (hit@1, hit@3, MRR) runnable against production <!-- k:eval script -->
<!-- memory:end Modules -->

## Data flow
<!-- memory:begin Data flow -->
- Added refs (keyword), related (keyword), note (text, not indexed), episode.commits (nested object); mappings auto-applied on boot. <!-- k:memories index mapping -->
- Episodes dedupe on source.session_id instead of globally; repeat Stop hooks update same record. <!-- k:session-scoped dedupe -->
- Non-empty deferred creates type=todo record linked by session; todo closure auto-chains to origin episode. <!-- k:deferred→todo chain -->
- memories (with refs, note, related, episode.commits fields), projects, oauth (token store), events (metrics), plus pipeline:hybrid-rrf <!-- k:Indices -->
- Episodes merge on source.session_id (one per session), facts merge on content_hash, todos spawn from deferred field <!-- k:Session-scoped dedupe -->
- Subobject tracking git commits attached to episodes, indexed for recall. <!-- k:episode.commits -->
- Bidirectional links to related records (up to 5 per write) via cosine similarity. <!-- k:related (keyword field) -->
- DCR clients, authorization codes, access/refresh tokens; never recreated on boot <!-- k:oauth index -->
- Metrics only: operation kind, client, project, latency, zero-result flag, top score, cached flag; no memory content <!-- k:events index -->
- Added refs (keyword), related (keyword), note (text, index:false), episode.commits (object with sha/message); refs union and note replace on repeat Stop; bidirectional link writes via scripted bulk update <!-- k:memories index -->
- Bidirectional keyword links to top 5 neighbors across all types by cosine ≥0.75, written via scripted bulk update <!-- k:memories.related -->
- refs: keyword links to ADRs and sessions; note: unindexed markdown (20 KB typical), not searchable <!-- k:memories.refs/note -->
- Now accepts refs (keywords to ADR/decision docs) and note (session summary markdown); returned via note_resource URI in recall. <!-- k:memory_remember tool -->
- Bidirectional cosine ≥0.75; top-5 per record; kNN across all types; backlinks via scripted bulk update; see_also deduped against query results <!-- k:related links -->
- Episodes dedupe on source.session_id instead of never; repeat Stop hook overwrites did/why/outcome/deferred/files rather than creating duplicate <!-- k:session-scoped episodes -->
- Non-empty deferred creates type=todo record; todo auto-closes (status=done) when deferred empties on repeat Stop <!-- k:deferred→todo pipeline -->
- post-commit hook ingests commits to /api/ingest/commit; attaches to same-device episode within 2h window or creates lightweight standalone episode <!-- k:git integration -->
- PreToolUse hook injects file history via additionalContext JSON; Edit/Write/MultiEdit tools get 4 lines of related episodes; Bash hook fires on deploy/docker/traefik/migrate patterns <!-- k:Pre-tool recall -->
- Stop hook runs claude -p extraction, creates session note with did/why/outcome/deferred/files, commits to docs/memory/sessions/{id}.md via git post-commit hook <!-- k:Session journaling -->
- On every write: kNN across all types in project, cosine ≥0.75, top-5 auto-linked bidirectionally via scripted bulk update; recall returns see_also (top-3, deduped) <!-- k:Related links -->
- Stop hook now dedupes episodes on source.session_id instead of never deduping; repeat fires update one record <!-- k:Episode deduplication -->
- Non-empty episode.deferred auto-creates type=todo; when deferred empties, todo status→done; session_id links them <!-- k:Deferred todo chain -->
- Post-commit hook sends commit sha, message, files, stat to /api/ingest/commit; attaches to live episode or creates light one <!-- k:Git commit ingestion -->
- Type-aware rerank → semantic rerank (bge-reranker-base if metrics show >30% zero-result) → top-K <!-- k:search-ranking -->
- Session-scoped dedupe on source.session_id; deferred field creates linked todo (status=active); closure chains episodes via session proximity <!-- k:episodes -->
- PreToolUse hook injects /api/file-context results as additionalContext JSON before tool calls; 240 chars/line, ≤4 lines per file <!-- k:pre-tool recall -->
- post-commit hook ingests commits via /api/ingest/commit; attaches to live episode (same project/device, ≤2h) or creates lightweight episode <!-- k:git commits -->
- Events index records recalls, writes, latency, cache hits; /api/stats emits zero-result%, p50/p95 latency, verdicts on search quality <!-- k:metrics -->
- Before Edit/Write/MultiEdit/Bash calls, memory-pretool.sh injects up to 4 lines of related work as JSON additionalContext, verified working on production. <!-- k:PreToolUse hook → additionalContext injection -->
- recall() chains type-aware rerank followed by optional semantic rerank (applies only if metric threshold met) <!-- k:Search pipeline -->
<!-- memory:end Data flow -->

## Integrations
<!-- memory:begin Integrations -->
- Ingest commits via POST /api/ingest/commit; attach to active episode or create lightweight one. <!-- k:git post-commit hook -->
- File-context recall on Edit|Write|MultiEdit|Bash; emits additionalContext JSON to Claude. <!-- k:PreToolUse hook -->
- SessionStart prints timeline, Stop hook journals episode+ADRs+facts+architecture patch+git commit, PreToolUse injects file context <!-- k:Claude Code hooks -->
- Auto-attaches commits to active episodes or creates lightweight episode, idempotent on SHA, skips memory:* commits <!-- k:Git post-commit -->
- Edit|Write|MultiEdit and Bash hooks emit PreToolUse JSON with file-context results (cached per session). <!-- k:Pre-tool recall hooks -->
- Server-side ingestion via POST /api/ingest/commit, indexed with sha, message, files, stat. <!-- k:Git post-commit hook -->
- Pre-tool recall; fetches /api/file-context per edited file, emits JSON hookSpecificOutput with additionalContext <!-- k:PreToolUse hook (Edit/Write/MultiEdit) -->
- Dynamic Client Registration endpoint /register; consent screen with password auth; token endpoint /token; revoke; persisted in oauth index, survives restarts <!-- k:OAuth with DCR -->
- Edit|Write|MultiEdit → file-context recall; Bash (filtered to deploy keywords) → recall on command name; emit JSON additionalContext for /api/file-context <!-- k:PreToolUse hooks -->
- Dynamic Client Registration on /register; clients, codes, tokens persisted in oauth index; supports web/mobile/Desktop without manual credential setup <!-- k:OAuth 2.0 with DCR -->
- Git hook at repo level ingests commits to /api/ingest/commit; attaches to live episode if project+device match within 2h, or creates light episode <!-- k:Post-commit hook -->
- PreToolUse hook injects file context (earlier work on the file) via additionalContext JSON; Bash hook filters to ops (docker/traefik/deploy/migrat) <!-- k:Pre-tool recall -->
- PKCE S256, DCR (clients self-register), password-protected consent, token rotation with refresh-token family revocation, 1h idle expiry for sessions <!-- k:OAuth 2.0 service -->
- contextum_search tool queries .contextum/ coordination state; added via npm package with string matching on tasks, agents, locks <!-- k:Contextum MCP Bridge -->
- DCR + static-bearer fallback; works on web, mobile, Desktop, Code; state in oauth index; PUBLIC_URL enables it <!-- k:OAuth 2.0 -->
- contextum_search tool queries .contextum/ state (tasks, locks, agents) to enable multi-agent coordination and conflict avoidance. <!-- k:Contextum coordination center -->
<!-- memory:end Integrations -->

## Infrastructure
<!-- memory:begin Infrastructure -->
- OpenSearch index persisting DCR clients, authorization codes, access/refresh tokens, with SHA-256 hashing and family revocation. <!-- k:oauth index -->
- Query metrics: recall count, zero-result %, latency p50/p95, pre-tool hit/miss, writes by source_kind. <!-- k:events index -->
- Unknown session id now returns 404 (not 400) to signal re-initialize; idle expiry at 1h; prevents stream leaks <!-- k:MCP sessions -->
- memories (with episode.commits, refs, note, related), projects, oauth (clients, codes, tokens, families), events (ts, kind, client, project, latency_ms, hits, top_score, cached) <!-- k:OpenSearch indices -->
- Service name corrected to aibrain_opensearch, OPENSEARCH_URL fixed to match, Traefik host updated to memory.ideainyou.com <!-- k:docker-compose.yml -->
<!-- memory:end Infrastructure -->

## Config
<!-- memory:begin Config -->
- New; enables OAuth. Required for web/mobile/Desktop connector support; defaults to OAuth disabled. <!-- k:PUBLIC_URL -->
- Cosine ≥ threshold for bidirectional linking; 0.75 (looser than 0.90 dedupe; about the same thing, not identical) <!-- k:RELATED_THRESHOLD -->
- Cosine ≥ threshold for fact/decision deduplication; 0.82 measured safe on production data <!-- k:DEDUPE_THRESHOLD -->
- Cosine ≥ threshold to suppress deferred todo when decision covers it; 0.75 default from real measurement <!-- k:TODO_DECISION_THRESHOLD -->
- Enable metrics collection (default true); /api/stats returns 503 if disabled <!-- k:METRICS_ENABLED -->
- true (default): memory_forget removes documents outright; false: reverts to soft delete (status=deleted, recoverable) <!-- k:FORGET_HARD_DELETE -->
- Auto-activates if metrics show >30% zero-result rate; defaults to true if memory available <!-- k:RERANKER_ENABLED -->
- New env vars for semantic reranking (off by default, trigger at >30% zero-result), digest cadence, and bulk import parallelism. <!-- k:RERANKER_ENABLED, DIGEST_SCHEDULE, IMPORT_BATCH_SIZE -->
- Boolean flag (default true) controlling whether bge-reranker-base model loads on startup <!-- k:SEMANTIC_RERANK_ENABLED -->
- Zero-result percentage threshold (default 30) that triggers reranker activation in production <!-- k:SEMANTIC_RERANK_THRESHOLD -->
- Registered in settings.json (install script previously omitted them, so they never fired); prior config backed up to ~/.claude/settings.json.bak-2026-09-30 <!-- k:PreToolUse hooks -->
- New 0.85 cosine threshold controlling when a new todo is merged into an existing open todo instead of created separately <!-- k:TODO_MERGE_THRESHOLD -->
<!-- memory:end Config -->

_Last auto-update: 2026-09-30 (session acf8fb1b)_
