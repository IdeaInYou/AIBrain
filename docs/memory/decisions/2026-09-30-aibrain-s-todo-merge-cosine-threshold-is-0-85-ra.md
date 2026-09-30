---
date: 2026-09-30
project: aibrain
status: accepted
session: docs/memory/sessions/2026-09-30-acf8fb1b.md
session_id: acf8fb1b-70d4-4263-9a48-ad96686790ce
generated: true
---
# AIBrain's todo-merge cosine threshold is 0.85 (raised from the general 0.82 dedupe threshold) because real duplicate todos measured 0.83-0.87 similarity, and this was the root cause of 4 near-identical open todos appearing at every SessionStart.

## Context
User asked whether TencentDB had anything worth porting into AIBrain, which led to auditing v5's actual code rather than trusting the prior session's self-reported test results.

## Decision
AIBrain's todo-merge cosine threshold is 0.85 (raised from the general 0.82 dedupe threshold) because real duplicate todos measured 0.83-0.87 similarity, and this was the root cause of 4 near-identical open todos appearing at every SessionStart.

## Consequences
Commits 7121413, eaf91e4, and 3e93f6f landed locally with 90/90 tests passing and eval showing hit@1 82%, hit@3 100%, MRR 0.902 on production; false claims (reranker, self-healing, Contextum, '20-30 min saved', gsd-core attribution) were corrected in both docs and AIBrain's own memory index.

**Follow-up:** Deploying and re-testing the fixes on production, deciding whether to add a product-level grouping layer above GetCheckout's separate microservice projects (get-checkout, getcheckout-api, getcheckout-new-admin, etc.), and confirming what the cart-item project actually was.
