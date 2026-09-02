---
date: 2026-09-02
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-02-d166fd70.md
session_id: d166fd70-6b99-44b4-825c-71532589e642
generated: true
---
# AIBrain is a parallel memory architecture to gsd-core, not derivative: vector-based semantic search (768-dim bge-base embeddings + kNN cosine) vs gsd-core's doc retrieval (BM25), pre-tool context injection vs pull-based retrieval, auto-dedup at 0.82 threshold with self-healing at >0.95, and OAuth 2.0 for multi-surface access.

## Context
AIBrain v3 lacked OAuth for web/mobile, had static token across 6 locations, duplicated episodes per session, no proactive context before tool calls, and no search-quality metrics; needed foundation for multi-agent memory + coordination.

## Decision
AIBrain is a parallel memory architecture to gsd-core, not derivative: vector-based semantic search (768-dim bge-base embeddings + kNN cosine) vs gsd-core's doc retrieval (BM25), pre-tool context injection vs pull-based retrieval, auto-dedup at 0.82 threshold with self-healing at >0.95, and OAuth 2.0 for multi-surface access.

## Consequences
All 4 features (reranker, digest, self-healing, imports) built and compiled; 4 commits ready for deploy; OAuth state survives restarts; episodes deduplicate correctly; Contextum tool allows agents to check locks and avoid conflicts; metrics enable data-driven optimization.

**Follow-up:** Token rotation (still in 6 locations, deferred to later); real data accumulation to trigger reranker (currently 0% zero-result, gate is >30%).
