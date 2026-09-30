---
date: 2026-09-30
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-30-acf8fb1b.md
session_id: acf8fb1b-70d4-4263-9a48-ad96686790ce
generated: true
---
# AIBrain's memory_update now marks the updated record as 'locked', and locked records are excluded from automatic overwriting: a re-saved paraphrase merges into the locked record instead of replacing it, deferred-todo merging skips replacing a locked todo, and merge-duplicates always keeps the locked side of a pair (skipping the pair entirely if both sides are locked).

## Context
These were the two remaining gaps identified in the TencentDB-Agent-Memory reconciliation, both needed before the pending duplicate-record merge could safely proceed.

## Decision
AIBrain's memory_update now marks the updated record as 'locked', and locked records are excluded from automatic overwriting: a re-saved paraphrase merges into the locked record instead of replacing it, deferred-todo merging skips replacing a locked todo, and merge-duplicates always keeps the locked side of a pair (skipping the pair entirely if both sides are locked).

## Consequences
Committed locally as 05edd71 with 93/93 tests passing and a clean build; the Bash hook update is already installed locally, but the server-side changes require a new deploy before min_sim can be calibrated or the 7 manually-corrected records can be locked.

**Follow-up:** Calibrating min_sim against real commands, locking the 7 already-corrected records, applying merge-duplicates at a chosen threshold (0.85 or 0.90), and setting DEDUPE_THRESHOLD=0.85 in the server .env all wait on the next deploy and Peter's threshold choice.
