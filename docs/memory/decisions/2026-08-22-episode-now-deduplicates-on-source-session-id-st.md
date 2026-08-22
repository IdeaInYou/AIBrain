---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# Episode now deduplicates on source.session_id; Stop hook repeat calls update the existing episode (did, why, outcome, deferred, files overwrite; embedding recomputed) rather than creating duplicates.

## Context
Scaling to claude.ai web and mobile requires OAuth; Stop hook repeat-firing created duplicate episodes; metrics needed to justify whether the 280MB reranker investment improved recall quality.

## Decision
Episode now deduplicates on source.session_id; Stop hook repeat calls update the existing episode (did, why, outcome, deferred, files overwrite; embedding recomputed) rather than creating duplicates.

## Consequences
All features deployed and tested live against production; OAuth working end-to-end, episode duplication collapsed 7→2 per session, metrics showing zero zero-results on test sample, thresholds measured and validated.

**Follow-up:** Commit 6653772 (MCP session 404 handling, idle timeout) ready but not deployed per user preference; reranker and digest pending metrics validation; static auth token should be rotated.
