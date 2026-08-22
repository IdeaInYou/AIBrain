---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain's OAuth uses Dynamic Client Registration so Claude registers itself with no manual Client ID/Secret; password auth on the server's consent page; static bearer still works in parallel for existing Claude Code and Desktop installs.

## Context
First production deployment to VPS; needed to fix blockers and implement full spec for web/mobile/Desktop connectivity.

## Decision
AIBrain's OAuth uses Dynamic Client Registration so Claude registers itself with no manual Client ID/Secret; password auth on the server's consent page; static bearer still works in parallel for existing Claude Code and Desktop installs.

## Consequences
Live and fully functional. OAuth works across all surfaces, episode dedupe verified, file-context ranked correctly on episode.files and refs, metrics instrumented (p50 76ms, zero-result 0%, pre-tool 2/2 hit), MCP sessions now idle-expire with 404 on unknown ids. 68 tests passing. System self-journaling via Stop hooks—this session auto-generated its own memory records.

**Follow-up:** Token rotation (6 locations—server .env, ~/.claude/memory.env, ~/.claude.json, Desktop, .env.example, this conversation), reranker (gated on metrics showing >30% zero-result %), digest, self-healing beyond dedupe, imports.
