---
date: 2026-08-22
project: aibrain
status: accepted
session: docs/memory/sessions/2026-08-22-57cf8914.md
session_id: 57cf8914-32d0-45df-9195-6af6e63fe081
generated: true
---
# AIBrain's OAuth uses PKCE-only public client registration (DCR); Claude registers itself on connect, so no Client ID/Secret fields are needed in the connector UI.

## Context
Create a persistent long-term memory system for Claude Code and web/mobile so work history, decisions, and project context survive across sessions and surfaces, automatically journaled by hooks.

## Decision
AIBrain's OAuth uses PKCE-only public client registration (DCR); Claude registers itself on connect, so no Client ID/Secret fields are needed in the connector UI.

## Consequences
Server live at ideainyou.com, OAuth enabled, 68 tests passing, hooks active in Claude Code, pre-tool recall confirmed working mid-session, `/api/stats` ready to measure whether search quality or missing data is the bottleneck.

**Follow-up:** Reranker and chunks (§4) pending metrics showing they help; digest (§6), self-healing (§7), imports (§5); token rotation (in six locations as of 2026-08-22).
