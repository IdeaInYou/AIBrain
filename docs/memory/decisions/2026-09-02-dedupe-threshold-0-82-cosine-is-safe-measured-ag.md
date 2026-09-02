---
date: 2026-09-02
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-02-d166fd70.md
session_id: d166fd70-6b99-44b4-825c-71532589e642
generated: true
---
# DEDUPE_THRESHOLD = 0.82 (cosine) is safe measured against 28 real records; 0.85 causes false merges of stack rationale from different decisions; 0.82 catches restatements without collapsing related-but-different facts.

## Context
v3 lacked OAuth for web/mobile surfaces, had manual episode deduplication, no git-aware journaling, no proactive context recall, and no coordination between multi-agent systems. Contextum integration emerged from user's two projects in Downloads folder revealing parallel coordination needs.

## Decision
DEDUPE_THRESHOLD = 0.82 (cosine) is safe measured against 28 real records; 0.85 causes false merges of stack rationale from different decisions; 0.82 catches restatements without collapsing related-but-different facts.

## Consequences
All features verified live: OAuth 17/17, episodes dedupe on session_id, pre-tool recall fires correctly, related links work bidirectionally, metrics show 76ms p50 latency and 0% false recalls, git commits attach to episodes, and contextum_search tool is callable by agents to avoid conflicts in multi-agent work.

**Follow-up:** Reranker (gated on >30% zero-result rate; currently 0%), digest, self-healing beyond dedupe, imports, MCP session 404 fix (commit 6653772), and token rotation (still in 6 locations).
