---
date: 2026-09-02
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-02-d166fd70.md
session_id: d166fd70-6b99-44b4-825c-71532589e642
generated: true
---
# Episode deduplication is session-scoped: Stop hook fires multiple times per session but updates one record keyed on source.session_id, overwriting did/why/outcome/deferred/files while preserving tags and taking max importance.

## Context
AIBrain v3 lacked OAuth for web/mobile, had static token across 6 locations, duplicated episodes per session, no proactive context before tool calls, and no search-quality metrics; needed foundation for multi-agent memory + coordination.

## Decision
Episode deduplication is session-scoped: Stop hook fires multiple times per session but updates one record keyed on source.session_id, overwriting did/why/outcome/deferred/files while preserving tags and taking max importance.

## Consequences
All 4 features (reranker, digest, self-healing, imports) built and compiled; 4 commits ready for deploy; OAuth state survives restarts; episodes deduplicate correctly; Contextum tool allows agents to check locks and avoid conflicts; metrics enable data-driven optimization.

**Follow-up:** Token rotation (still in 6 locations, deferred to later); real data accumulation to trigger reranker (currently 0% zero-result, gate is >30%).
