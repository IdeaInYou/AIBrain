---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# OAuth DCR implementation in AIBrain maintains full backward compatibility: static bearer token still works alongside new OAuth clients, existing Claude Code and Desktop bridge installations unaffected.

## Context
First production deployment of the memory server required fixing blockers, implementing the complete UPDATE.md and UPDATE2.md design, and validating all systems work together before finalizing configuration.

## Decision
OAuth DCR implementation in AIBrain maintains full backward compatibility: static bearer token still works alongside new OAuth clients, existing Claude Code and Desktop bridge installations unaffected.

## Consequences
Server fully operational and tested. OAuth 17/17 end-to-end; all features working: dedupe, related links, metrics, file-context, git commits, todo closure. DEDUPE_THRESHOLD=0.82 and TODO_DECISION_THRESHOLD=0.75 calibrated by real data. One pending deploy: MCP unknown-session 404 response.

**Follow-up:** MCP session persistence (commit 6653772 awaiting deploy), reranker (gated on metrics signal), digest, self-healing, imports, token rotation.
