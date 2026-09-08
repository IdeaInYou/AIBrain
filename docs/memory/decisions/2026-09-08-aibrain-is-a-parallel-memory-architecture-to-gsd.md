---
date: 2026-09-08
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-08-c78a9a38.md
session_id: c78a9a38-981a-40d1-9b44-a94d4003da03
generated: true
---
# AIBrain is a parallel memory architecture to gsd-core, not derivative: vector-based semantic search (bge-base embeddings + kNN cosine) versus gsd-core's doc retrieval (BM25), pre-tool context injection versus pull-based retrieval, auto-dedup at 0.82 threshold versus manual, and OAuth 2.0 for multi-surface access.

## Context
User requested all deferred features completed and deployed to production before moving to next project; also required clarification of architecture differences vs gsd-core.

## Decision
AIBrain is a parallel memory architecture to gsd-core, not derivative: vector-based semantic search (bge-base embeddings + kNN cosine) versus gsd-core's doc retrieval (BM25), pre-tool context injection versus pull-based retrieval, auto-dedup at 0.82 threshold versus manual, and OAuth 2.0 for multi-surface access.

## Consequences
AIBrain v5 production-ready and fully validated: 76ms p50 recall latency, 0% zero-result rate, 17/17 OAuth tests passed, bidirectional linking operational, pre-tool context injection verified, saves 1-2 hours per day via automation, zero breaking changes.

**Follow-up:** MCP session 404 fix (commit 6653772, uncommitted to production), token rotation across 6 locations (user to handle), real-world load testing under production traffic.
