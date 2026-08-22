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
<!-- memory:end Integrations -->

## Infrastructure
<!-- memory:begin Infrastructure -->
- OpenSearch index persisting DCR clients, authorization codes, access/refresh tokens, with SHA-256 hashing and family revocation. <!-- k:oauth index -->
- Query metrics: recall count, zero-result %, latency p50/p95, pre-tool hit/miss, writes by source_kind. <!-- k:events index -->
- Unknown session id now returns 404 (not 400) to signal re-initialize; idle expiry at 1h; prevents stream leaks <!-- k:MCP sessions -->
<!-- memory:end Infrastructure -->

## Config
<!-- memory:begin Config -->
- New; enables OAuth. Required for web/mobile/Desktop connector support; defaults to OAuth disabled. <!-- k:PUBLIC_URL -->
- Cosine ≥ threshold for bidirectional linking; 0.75 (looser than 0.90 dedupe; about the same thing, not identical) <!-- k:RELATED_THRESHOLD -->
- Cosine ≥ threshold for fact/decision deduplication; 0.82 measured safe on production data <!-- k:DEDUPE_THRESHOLD -->
- Cosine ≥ threshold to suppress deferred todo when decision covers it; 0.75 default from real measurement <!-- k:TODO_DECISION_THRESHOLD -->
- Enable metrics collection (default true); /api/stats returns 503 if disabled <!-- k:METRICS_ENABLED -->
<!-- memory:end Config -->

_Last auto-update: 2026-08-22 (session 57cf8914)_
