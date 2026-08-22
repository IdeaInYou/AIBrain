---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain episode deduplication now scopes to session_id to prevent Stop hook duplication; episodes are created once per session and updated on repeat Stop, with deferred work converted to separate type=todo records.

## Context
First production deployment of the memory server required fixing blockers, implementing the complete UPDATE.md and UPDATE2.md design, and validating all systems work together before finalizing configuration.

## Decision
AIBrain episode deduplication now scopes to session_id to prevent Stop hook duplication; episodes are created once per session and updated on repeat Stop, with deferred work converted to separate type=todo records.

## Consequences
Server fully operational and tested. OAuth 17/17 end-to-end; all features working: dedupe, related links, metrics, file-context, git commits, todo closure. DEDUPE_THRESHOLD=0.82 and TODO_DECISION_THRESHOLD=0.75 calibrated by real data. One pending deploy: MCP unknown-session 404 response.

**Follow-up:** MCP session persistence (commit 6653772 awaiting deploy), reranker (gated on metrics signal), digest, self-healing, imports, token rotation.
