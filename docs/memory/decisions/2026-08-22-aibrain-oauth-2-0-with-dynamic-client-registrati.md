---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain OAuth 2.0 with Dynamic Client Registration allows no manual setup (Claude registers itself); password-protected consent screen; static bearer token remains active in parallel for backward compatibility with existing Code/Desktop installs.

## Context
Real production deployment exposed HEAD-404 regression; OAuth needed for web/mobile support; linked-notes system essential for session continuity; pre-tool recall to surface work history in context; metrics to measure whether reranker justifies 280 MB cost.

## Decision
AIBrain OAuth 2.0 with Dynamic Client Registration allows no manual setup (Claude registers itself); password-protected consent screen; static bearer token remains active in parallel for backward compatibility with existing Code/Desktop installs.

## Consequences
AIBrain live on https://memory.ideainyou.com with all four surfaces connected (Code, Desktop, claude.ai, mobile/web via OAuth); 70 tests passing; OAuth end-to-end verified (17/17); one production session fully self-journaled; zero-result% at 0% (metrics infrastructure working but sample too small).

**Follow-up:** Token rotation (now in 6 locations); MCP session 404 fix and threshold recalibration waiting on deploy (commit 6653772); reranker gated on /api/stats showing >30% zero-result rate; docker-compose.yml OPENSEARCH_URL inconsistency; digest, self-healing beyond dedupe, imports.
