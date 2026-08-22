---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain uses DEDUPE_THRESHOLD=0.82 (not 0.85) to merge restatements without collapsing distinct decisions; measured 0.8602 cosine for genuine bge/OpenSearch duplicates, but 0.7976 for OAuth DCR pair—which is a rationale difference and should stay separate.

## Context
The memory system needed multi-surface access (web, mobile, Desktop), session-aware deduplication to replace the earlier v3 duplication, git-based work capture, and measurable recall quality before optimizing with search ranking.

## Decision
AIBrain uses DEDUPE_THRESHOLD=0.82 (not 0.85) to merge restatements without collapsing distinct decisions; measured 0.8602 cosine for genuine bge/OpenSearch duplicates, but 0.7976 for OAuth DCR pair—which is a rationale difference and should stay separate.

## Consequences
Production system live with OAuth + static-bearer backward compatibility, sessions persisting across restarts, pre-tool recall proven working via AdditionalContext, episode deduplication collapsing four duplicates to one, deferred→todo automation eliminating open-work noise. Metrics instrumented to decide reranker ROI.

**Follow-up:** Token rotation (now in 6 places), reranker implementation gated on zero-result% > 30, digest, self-healing beyond dedupe, imports, MCP session 404 fix and TODO_DECISION_THRESHOLD=0.75 awaiting next deployment.
