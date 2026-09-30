---
date: 2026-09-30
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-30-acf8fb1b.md
session_id: acf8fb1b-70d4-4263-9a48-ad96686790ce
generated: true
---
# AIBrain's memory_remember tool now returns a 'similar' field with candidate near-duplicate records so the calling Claude decides whether to store, update, merge, or skip, instead of the server auto-deciding via a fixed cosine threshold.

## Context
User asked Claude to check the TencentDB-Agent-Memory repo in Downloads and determine whether AIBrain could be improved, then approved implementing everything useful found.

## Decision
AIBrain's memory_remember tool now returns a 'similar' field with candidate near-duplicate records so the calling Claude decides whether to store, update, merge, or skip, instead of the server auto-deciding via a fixed cosine threshold.

## Consequences
All fixes and new features committed locally (commits 7121413, eaf91e4, 3e93f6f) with 90/90 tests passing and an eval baseline of hit@1 82%, hit@3 100%, MRR 0.902 on 22 production queries; the user deployed to production and verification was starting when the session ended.

**Follow-up:** Whether to merge or add a shared product-level grouping layer over GetCheckout's separate AIBrain projects (get-checkout, getcheckout-api, getcheckout-new-admin) remains pending user input, along with a memory web panel and Skills-as-SKILL.md generation.
