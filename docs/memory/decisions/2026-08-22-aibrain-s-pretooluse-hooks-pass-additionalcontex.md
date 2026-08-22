---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain's PreToolUse hooks pass additionalContext to Claude on this build (confirmed: hook output quartz-lantern-4417 echoed by model mid-session), unblocking /api/file-context and pre-tool recall.

## Context
Complete the Memory MCP system for long-term context across Claude surfaces (Code, Desktop, web, mobile) with automatic session journaling via hooks.

## Decision
AIBrain's PreToolUse hooks pass additionalContext to Claude on this build (confirmed: hook output quartz-lantern-4417 echoed by model mid-session), unblocking /api/file-context and pre-tool recall.

## Consequences
Server live on Hetzner, health checks green, OAuth ready, all hooks working and already auto-journaling sessions; remaining work is configuration (PUBLIC_URL, hook enablement, optional token rotation and metrics gatekeeping for reranker).

**Follow-up:** Reranker (gated on /api/stats data + 800 MB free RAM), digest, self-healing/imports, token rotation in 6 locations (.env.example, server, Code, Desktop, claude.ai web, mobile).
