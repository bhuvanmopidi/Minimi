# Phase 1: The web search agent

**Goal:** the agent searches the web when it needs to, cites its sources, and shows its searches live.
In this phase, Sonnet decides by itself when to search. The planner and prefetching come in Phase 3.

Design: [ADR-0010](../decisions/0010-web-search-tool.md).

## What was built

| File | What it does |
|---|---|
| [src/tools/tavily.ts](../../src/tools/tavily.ts) | A small Tavily REST client (`advanced` depth, 3 chunks per source, 5 results, optional `start_date`) behind a `SearchProvider` function type |
| [src/tools/webSearch.ts](../../src/tools/webSearch.ts) | The `web_search` tool: 1–4 parallel queries, 10-min cache, 8 s timeout, snippet trimming, a per-turn `SourceRegistry` for stable `[n]` numbers, partial/total failure handling |
| [src/app/api/chat/route.ts](../../src/app/api/chat/route.ts) | Registers the tool and caps the loop at 5 steps. Search snapshots are saved in the same transaction as the answer |
| [src/memory/repo.ts](../../src/memory/repo.ts) | `insertSearches` |
| [src/agent/prompts.ts](../../src/agent/prompts.ts) | Prompt v1: when to search and when not, batching related queries, `since`/`news`, inline `[n]` citations, preferring official sources, stating freshness, and behaviour when search is down |
| [src/components/SearchStep.tsx](../../src/components/SearchStep.tsx) | Live "Searching: q1 · q2", then source chips (`[n] domain · date`) that link to the page |
| [tests/webSearch.test.ts](../../tests/webSearch.test.ts) | 9 tests using a fake provider: parallel queries and ranking, stable numbering across calls, duplicate URLs, cache hit/expiry/key, partial and total failure, not configured, parameter pass-through, trimming |

## Changes from the plan
- **The Tavily SDK was replaced with a direct `fetch` client**, because of a zod version conflict. See ADR-0010 §3.

## How it was checked
- `npm run typecheck`: clean. `npm test`: 13/13 passing.
- **Live, with real Claude and Tavily keys:**
  - *"Hi! In one sentence, what can you help me with?"*: answered without searching.
  - *"What is the current price of the Neon Postgres Launch plan?"*: one tool call with two parallel
    queries. The answer led with the official pricing page, gave usage-based rates with `[n]` citations,
    and flagged the out-of-date figures third-party guides still quote. Both searches were saved and
    linked to the answer, and both were cached.
- **Live, with search disabled:** *"Who won the most recent Formula 1 race?"*: the tool returned
  "not configured", and the agent said it couldn't verify instead of guessing.

## Known limits (addressed later)
- Past turns are sent to the model as answer text only, without their sources (Phase 4 context work).
- Answers render as plain text; markdown and a sources panel come in Phase 5.
