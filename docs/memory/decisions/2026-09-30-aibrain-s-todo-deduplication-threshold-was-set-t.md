---
date: 2026-09-30
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-30-acf8fb1b.md
session_id: acf8fb1b-70d4-4263-9a48-ad96686790ce
generated: true
---
# AIBrain's todo deduplication threshold was set to 0.85 cosine similarity for merging a new todo into an existing open one, based on observed duplicate todos scoring 0.83-0.87, eliminating the recurring near-identical todo entries seen at every session start.

## Context
User asked to review the TencentDB repo for ways to improve AIBrain, then after two rounds of "is that everything?" asked for all useful ideas to be implemented before the next deploy/test cycle.

## Decision
AIBrain's todo deduplication threshold was set to 0.85 cosine similarity for merging a new todo into an existing open one, based on observed duplicate todos scoring 0.83-0.87, eliminating the recurring near-identical todo entries seen at every session start.

## Consequences
90/90 tests pass locally, three commits (7121413, eaf91e4, 3e93f6f) are ready but not yet deployed, and the production eval shows hit@1 82%, hit@3 100%, MRR 0.902.

**Follow-up:** A web memory-editing panel, Skills auto-suggestion (SKILL.md), and consolidating GetCheckout's four separate memory projects into one were explicitly postponed pending user approval.
