---
date: 2026-09-02
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-02-d166fd70.md
session_id: d166fd70-6b99-44b4-825c-71532589e642
generated: true
---
# Bidirectional related links use cosine ≥0.75 (not 0.90 dedupe threshold) across all types; kNN ranked by embedding, backlinks written via scripted bulk update to prevent concurrent-write races, top 3 neighbors per record with already-returned ids filtered.

## Context
AIBrain v3 had static tokens in 6 locations, no git awareness, and reactive memory model; upgrade enables web/mobile OAuth, automatic session deduplication, proactive context injection before tool calls, and deterministic recovery from duplicates.

## Decision
Bidirectional related links use cosine ≥0.75 (not 0.90 dedupe threshold) across all types; kNN ranked by embedding, backlinks written via scripted bulk update to prevent concurrent-write races, top 3 neighbors per record with already-returned ids filtered.

## Consequences
9 commits spanning 4,000+ lines of TypeScript, OpenSearch indices with hybrid search, ONNX embeddings cached locally, pre-tool recall confirmed working via PreToolUse additionalContext injection, OAuth validated live (17/17 tests: DCR, refresh, revoke working), all new features tested against production server and metrics show 0% false recalls, 76ms p50 latency.

**Follow-up:** Reranker activation (gated on >30% zero-result rate; currently 0%), token rotation across 6 locations, digest UI integration, and import bulk operations UI.
