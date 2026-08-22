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
The deployed server was crash-looping on a faulty HEAD request handler; the session aimed to complete UPDATE.md and UPDATE2.md specs and prepare the system for first real use.

## Decision
AIBrain uses DEDUPE_THRESHOLD=0.82 (not 0.85) to merge restatements without collapsing distinct decisions; measured 0.8602 cosine for genuine bge/OpenSearch duplicates, but 0.7976 for OAuth DCR pair—which is a rationale difference and should stay separate.

## Consequences
Memory server is live and healthy at https://memory.ideainyou.com; full OAuth, MCP protocol, and memory feature tests passing (70+); system self-journaling via Stop hook; all new routes deployed and verified working; two features deferred pending deployment (todo-decision suppression at 0.75 threshold, MCP session 404 handling).

**Follow-up:** Pushing to git and container deploy (user owns both); reranker gated on metrics showing >30% zero-result rate; digest, advanced self-healing beyond dedupe, and imports not yet built.
