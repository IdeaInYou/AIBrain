---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain reranker is explicitly gated: /api/stats runs first to measure whether zero-result rate is >30% (data missing) vs ranked badly; reranker (bge-reranker-base, 280 MB) only lands if ranking is the problem and free RAM ≥ 800 MB.

## Context
Complete the Memory MCP system for long-term context across Claude surfaces (Code, Desktop, web, mobile) with automatic session journaling via hooks.

## Decision
AIBrain reranker is explicitly gated: /api/stats runs first to measure whether zero-result rate is >30% (data missing) vs ranked badly; reranker (bge-reranker-base, 280 MB) only lands if ranking is the problem and free RAM ≥ 800 MB.

## Consequences
Server live on Hetzner, health checks green, OAuth ready, all hooks working and already auto-journaling sessions; remaining work is configuration (PUBLIC_URL, hook enablement, optional token rotation and metrics gatekeeping for reranker).

**Follow-up:** Reranker (gated on /api/stats data + 800 MB free RAM), digest, self-healing/imports, token rotation in 6 locations (.env.example, server, Code, Desktop, claude.ai web, mobile).
