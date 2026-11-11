# 0012: Re-checks driven by the claims ledger, searching before the answer, and reasoning effort

**Status:** Accepted (Phase 3)

## Context
Phase 2 answered "has it changed since?" correctly but had two problems ([Phase 2 log](../phases/phase-2-memory.md)):
1. **Inconsistent:** it compared against old prose, so two runs labelled the same Neon fact
   "not a new change" and "changed".
2. **Slow:** 15–22 s, because Sonnet only decided to search after it started answering.

## 1. Re-checks compare against the claims ledger
[ADR-0006](0006-claims-ledger.md) is now built. After each answer that used web sources, Haiku
extracts its checkable facts in the background ([src/agent/claims.ts](../../src/agent/claims.ts)):
entity · attribute · value · source URL · source date. History search returns each old answer's
facts as `<facts_then>`, and the prompt requires exactly **one status per fact**, with fixed meanings:

| Status | Meaning |
|---|---|
| Changed | the current value differs from what was said then |
| Unchanged | the current value is the same |
| Couldn't verify | no reliable current source either way; no guessing |
| Correction | what was said then was already wrong at the time |

*Correction* was added after the live tests: several "changes" were really the old answer being
wrong (HubSpot's $100 was the monthly-billing price). Calling that "changed" would be dishonest.

**Only sourced answers are processed.** The ledger stores facts we can point to evidence for, not
the model's unsourced memory, and it saves a model call on chit-chat. Re-check answers also go
through extraction, so the next re-check compares against the latest values, not the original ones.

*Considered:* a separate structured "verdict" model call that returns the per-fact statuses as JSON,
rendered by code. ➖ An extra sequential model call on the slowest path. The fixed labels plus an
explicit fact list gave consistent tables in every live run, so this wasn't needed.

## 2. Searches start before the answer (prefetch)
The planner now also returns `searches` (≤4), an `intent` (`new_question / follow_up / recall /
recheck / chit_chat`) and a first-turn `title`. Before Sonnet starts, code runs
([src/agent/searchPlan.ts](../../src/agent/searchPlan.ts)):
- the planner's searches, and
- **on a re-check, one search per recorded fact**: "HubSpot Sales Hub Professional plan price"… The
  planner can't know which five CRM tools were on Monday's list; the ledger does.

These run in parallel (batches of ≤4, at most 8 queries) through the same `runWebSearch` as the tool,
so they share the turn's citation numbers, cache and saved snapshots. They appear in the UI exactly
like tool calls. Fact searches use **no `since` filter**: pricing pages usually have no publish date,
and a date filter dropped them in testing (Phase 2 runs had to search twice). Sonnet keeps
`web_search` for anything still missing.

## 3. Planner fix found by measuring
"What did I ask on 3 Nov? Is your answer still correct?" was classed as `recall`, so no fact searches
ran and Sonnet searched by itself (slow path). The rule now says a message that does both is a `recheck`.

## 4. Reasoning effort for the main model: `medium`
Per-stage timing (now logged per turn as a `[turn]` line) showed that most of the remaining wait
was **Sonnet 5.5 thinking before its first word**: 6.6–9.3 s on re-checks.

| Effort | First word on screen (re-checks) | Notes |
|---|---|---|
| model default | 8.1–10.6 s | always thinks first |
| `low` | 3.9–4.3 s | same verdicts and citations in the live comparison |
| **`medium` (chosen)** | 3.7–3.9 s on simple re-checks, 8.8 s on the 5-tool CRM comparison | thinks only when the question is hard |

The user chose `medium` as the balance between speed and reasoning on hard comparisons. It is
configurable via `MAIN_EFFORT` (`low | medium | high`).

## Results (live, real Claude + Tavily, demo chats)

| Question | Phase 2 | Phase 3 |
|---|---|---|
| "Last Tuesday… Postgres… changed since?" | 17.1 s total | first word 3.7 s · 10.0 s total |
| "On Monday… 5 CRM tools… changed since?" | 22.3 s total | first word 8.8 s · 15.4 s total |
| "What did I ask on 3 Nov? Still correct?" | 14.8 s total | first word 3.9 s · 9.2 s total |
| Same Neon fact across runs | "not a new change" vs "changed" | consistently flagged as **Correction** |

## Consequences
- One more background Haiku call per sourced answer (claim extraction). The user never waits for it.
- Tavily latency varies a lot (0.6–5 s for the same kind of query) and is now the largest variable.
  This is input for Phase 4.
- Chats created before Phase 3 have no recorded facts. Re-checks then fall back to the old answer
  text, as in Phase 2.
