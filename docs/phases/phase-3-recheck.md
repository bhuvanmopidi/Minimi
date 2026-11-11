# Phase 3: Faster, consistent "has it changed?" answers

**Goal:** fix the two weaknesses Phase 2 showed: slow re-checks (15–22 s) and inconsistent labels.
Design and measurements: [ADR-0012](../decisions/0012-recheck-prefetch-effort.md).

## How a re-check flows now

```
"On Monday we shortlisted 5 CRM tools… has any of them changed pricing since?"
  │
  ├─ planner (Haiku, 1.3–1.9 s): intent=recheck · needsHistory · dates · searches · title
  ├─ history (SQLite, ~10 ms): Monday 9 Nov chat + its 5 recorded facts (claims ledger)
  ├─ prefetch (Tavily, parallel): one search per fact: "HubSpot Sales Hub Professional plan price", …
  ├─ context: <facts_then> + numbered <search_results>
  ├─ Sonnet (effort: medium): one status per fact: Changed / Unchanged / Couldn't verify / Correction
  └─ background: Haiku records today's facts → next re-check compares against these
```

## What was built

| File | What it does |
|---|---|
| [src/agent/claims.ts](../../src/agent/claims.ts) | Claim extraction (Haiku, structured), citation number → source URL/date, sourced answers only, runs in the background |
| [src/agent/searchPlan.ts](../../src/agent/searchPlan.ts) | Decides the searches to run before the answer: the planner's + one per recorded fact on a re-check; dedupe, batches of 4, max 8 |
| [src/agent/planner.ts](../../src/agent/planner.ts) | Adds `intent`, `searches`, `title`; recheck-vs-recall rule fixed |
| [src/agent/orchestrator.ts](../../src/agent/orchestrator.ts) | Prefetch shown live (`data-search` parts), shared citation registry, titles, claims after save, `[turn]` timing log per stage, effort setting |
| [src/agent/context.ts](../../src/agent/context.ts) | `<intent>`, `<facts_then>` per past exchange, prefetched `<search_results>` |
| [src/agent/prompts.ts](../../src/agent/prompts.ts) | The four fixed statuses; use prefetched results, search only for what's missing |
| [src/memory/repo.ts](../../src/memory/repo.ts) | `insertClaims`, `claimsForMessages`, `setTitleIfMissing` |
| [src/memory/retrieval.ts](../../src/memory/retrieval.ts) | Each exchange carries its claims |
| [src/memory/demo.ts](../../src/memory/demo.ts) | Demo answers come with their recorded facts |
| [src/config.ts](../../src/config.ts) | `MAIN_EFFORT` (default `medium`) |
| [tests/claims.test.ts](../../tests/claims.test.ts) | Extraction mapping, sourced-only rule, claims in history, old chats without claims, prefetch planning, context rendering, titles |

## Changes from the agreed approach
- **A fourth status, "Correction"**: live tests showed many "changes" were really errors in the
  original answer.
- **Fact searches don't use a `since` date**: pricing pages have no publish date, so the filter
  dropped them.
- **Reasoning effort became a setting (`medium`)**: measuring showed thinking was most of the wait.
  You chose medium over low and the default.
- **Per-turn timing log** (`[turn] …` in the server output), pulled forward from Phase 4 because it
  was needed to find the cause of the latency.

## How it was checked
- `npm run typecheck`: clean. `npm test`: 77/77.
- **Live**, before/after: see the results table in ADR-0012. Re-checks now take 3.7–3.9 s to the first word
  (simple) and 8.8 s (5-tool comparison), down from 15–22 s for the whole answer. Each fact gets
  exactly one status, and the Neon fact is labelled consistently across runs.
- **Ledger:** after 4 live questions, 45 facts were recorded with their source domains (e.g. "GitHub Copilot
  Business | Price per user per month | $19 | docs.github.com"), with 0 extraction failures. Titles
  were set ("CRM shortlist pricing recheck", …).

## Known limits (next phase)
- **Tavily latency varies from 0.6 s to 5 s** per search, now the biggest variable in time to first word.
- The planner adds ~1.5 s to every turn, including chit-chat.
- Answers are plain text, without markdown formatting (Phase 5).
