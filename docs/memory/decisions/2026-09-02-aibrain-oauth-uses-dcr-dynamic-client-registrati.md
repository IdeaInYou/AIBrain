---
date: 2026-09-02
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-02-d166fd70.md
session_id: d166fd70-6b99-44b4-825c-71532589e642
generated: true
---
# AIBrain OAuth uses DCR (Dynamic Client Registration) and static-bearer fallback; OAuth state (clients, codes, tokens) persists in the oauth index across container restarts; works on claude.ai, Desktop, mobile, and Code via Connectors + mcp-remote bridge.

## Context
AIBrain v3 had static tokens in 6 locations, non-deduped episodes, no git history capture, and no proactive context recall. The upgrade enables web/mobile access via OAuth, deterministic episode deduplication, commit journaling, memory surfacing before tool calls, and coordination with multi-agent Contextum systems.

## Decision
AIBrain OAuth uses DCR (Dynamic Client Registration) and static-bearer fallback; OAuth state (clients, codes, tokens) persists in the oauth index across container restarts; works on claude.ai, Desktop, mobile, and Code via Connectors + mcp-remote bridge.

## Consequences
Production server healthy; OAuth validated live (17/17 tests: DCR, consent, code, refresh, revoke working); session-scoped episodes, deferred→todo, related links, file-context ranking, metrics (76 ms p50 latency, 0% false recalls) all verified. Contextum integration live, allowing agents to query coordination state alongside memory recall.

**Follow-up:** Reranker (gated on >30% zero-result rate; currently 0%), digest, self-healing beyond dedupe, imports, token rotation (still in 6 locations), and MCP session 404 fix (commit 6653772 uncommitted pending user push).
