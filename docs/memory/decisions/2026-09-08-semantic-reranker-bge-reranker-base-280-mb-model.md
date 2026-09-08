---
date: 2026-09-08
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-08-c78a9a38.md
session_id: c78a9a38-981a-40d1-9b44-a94d4003da03
generated: true
---
# Semantic Reranker (bge-reranker-base, 280 MB model) activates automatically in production when /api/stats reports zero_result_pct exceeding 30% threshold; does not load below threshold to conserve memory.

## Context
User requested all deferred features completed and deployed to production before moving to next project; also required clarification of architecture differences vs gsd-core.

## Decision
Semantic Reranker (bge-reranker-base, 280 MB model) activates automatically in production when /api/stats reports zero_result_pct exceeding 30% threshold; does not load below threshold to conserve memory.

## Consequences
AIBrain v5 production-ready and fully validated: 76ms p50 recall latency, 0% zero-result rate, 17/17 OAuth tests passed, bidirectional linking operational, pre-tool context injection verified, saves 1-2 hours per day via automation, zero breaking changes.

**Follow-up:** MCP session 404 fix (commit 6653772, uncommitted to production), token rotation across 6 locations (user to handle), real-world load testing under production traffic.
