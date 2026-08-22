---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain's metrics (events index, /api/stats) measure zero-result rate and pre-tool recall hit rate before committing to reranker or chunking, per the design principle of measuring before optimizing.

## Context
Create a persistent long-term memory system for Claude Code and web/mobile so work history, decisions, and project context survive across sessions and surfaces, automatically journaled by hooks.

## Decision
AIBrain's metrics (events index, /api/stats) measure zero-result rate and pre-tool recall hit rate before committing to reranker or chunking, per the design principle of measuring before optimizing.

## Consequences
Server live at ideainyou.com, OAuth enabled, 68 tests passing, hooks active in Claude Code, pre-tool recall confirmed working mid-session, `/api/stats` ready to measure whether search quality or missing data is the bottleneck.

**Follow-up:** Reranker and chunks (§4) pending metrics showing they help; digest (§6), self-healing (§7), imports (§5); token rotation (in six locations as of 2026-08-22).
