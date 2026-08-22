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
<!-- memory:end Modules -->

## Data flow
<!-- memory:begin Data flow -->
- Added refs (keyword), related (keyword), note (text, not indexed), episode.commits (nested object); mappings auto-applied on boot. <!-- k:memories index mapping -->
- Episodes dedupe on source.session_id instead of globally; repeat Stop hooks update same record. <!-- k:session-scoped dedupe -->
- Non-empty deferred creates type=todo record linked by session; todo closure auto-chains to origin episode. <!-- k:deferred→todo chain -->
- memories (with refs, note, related, episode.commits fields), projects, oauth (token store), events (metrics), plus pipeline:hybrid-rrf <!-- k:Indices -->
- Episodes merge on source.session_id (one per session), facts merge on content_hash, todos spawn from deferred field <!-- k:Session-scoped dedupe -->
<!-- memory:end Data flow -->

## Integrations
<!-- memory:begin Integrations -->
- Ingest commits via POST /api/ingest/commit; attach to active episode or create lightweight one. <!-- k:git post-commit hook -->
- File-context recall on Edit|Write|MultiEdit|Bash; emits additionalContext JSON to Claude. <!-- k:PreToolUse hook -->
- SessionStart prints timeline, Stop hook journals episode+ADRs+facts+architecture patch+git commit, PreToolUse injects file context <!-- k:Claude Code hooks -->
- Auto-attaches commits to active episodes or creates lightweight episode, idempotent on SHA, skips memory:* commits <!-- k:Git post-commit -->
<!-- memory:end Integrations -->

## Infrastructure
<!-- memory:begin Infrastructure -->
<!-- memory:end Infrastructure -->

## Config
<!-- memory:begin Config -->
- New; enables OAuth. Required for web/mobile/Desktop connector support; defaults to OAuth disabled. <!-- k:PUBLIC_URL -->
<!-- memory:end Config -->

_Last auto-update: 2026-08-22 (session 57cf8914)_
