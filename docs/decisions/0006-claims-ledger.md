# 0006: A claims ledger for "what changed since" questions

**Status:** Accepted

## Context
"Has any of them changed pricing since Monday?" needs two things: what we said on Monday, and
what is true now. Re-reading Monday's prose and guessing is unreliable.

## Options
- **Re-read the old answer text.** ➖ The model has to pull facts out of prose every time, and may miss some.
- **Structured claims (chosen).** After each answer, Haiku extracts the facts it asserted in a
  structured form and stores them.

## Decision
After each answer (in the background, off the critical path), Haiku extracts claims:
```json
{ "entity": "Neon", "attribute": "Launch plan price", "value": "$19/mo",
  "sourceUrl": "https://neon.tech/pricing", "sourceDate": "2026-11-01" }
```
stored in `claims` with `asserted_at`. A re-check question pulls the old claims, searches for fresh
evidence since that date, and labels each claim **changed / unchanged / couldn't verify**.

## Consequences
- One extra cheap model call per answer, which the user never waits for.
- Every re-check stores new claims, so next week's comparison is against today's answer.
- Extraction quality matters, so it is covered by evals in Phase 6.
