# 0010: Design of the web search tool

**Status:** Accepted (Phase 1). Replaces the "`@tavily/core` SDK" detail in [0001](0001-tech-stack.md). §5 (trimming) refined by [0016](0016-passage-selection.md).

## Context
Web search is the agent's only tool, so its shape decides how fast and how well the agent
answers. It needs to handle comparisons ("5 CRM tools"), date filters ("since Monday"), failures,
and citations that stay consistent.

## Decisions

### 1. Several queries per call, run in parallel
`web_search({ queries: string[1..4], since?: "YYYY-MM-DD", topic?: "general" | "news" })`
- **Considered:** one query per call. ➖ A 5-product comparison would cost 5 sequential model steps.
- **Chosen:** up to 4 queries per call with `Promise.all`. The model asks for everything it needs in
  one step, and the call takes as long as the slowest query rather than the sum.

### 2. Tavily `advanced` depth
| | `basic` | **`advanced` (chosen)** |
|---|---|---|
| Speed | ~0.5–1 s | ~1–2 s |
| Content | general snippets | the most relevant passages per page (`chunks_per_source: 3`) |
| Cost | 1 credit | 2 credits |

The brief's questions turn on exact details (prices, plan names), so quality wins. Because queries
run in parallel, the extra time is paid once per call.

### 3. Call Tavily's REST API with `fetch`, not the SDK
- **Considered:** `@tavily/core`. ➖ Its zod 4 peer dependency conflicts with our zod 3 (which the AI SDK
  uses). ➖ Little value, since search is a single POST endpoint.
- **Chosen:** a ~50-line client ([src/tools/tavily.ts](../../src/tools/tavily.ts)). No version
  conflict, and direct control over the timeout and every parameter.
- The provider is a plain function type (`SearchProvider`), so tests inject a fake and another search
  backend could be swapped in without touching the tool.

### 4. A per-turn source registry for citations
Every result gets a number `[n]` that stays fixed for the whole answer, across multiple searches.
Duplicate URLs (ignoring `www.`, trailing slashes, `utm_*` and `#fragments`) keep their first number.
Without this, a second search would restart at [1] and citations would point at the wrong pages.

### 5. Trim results before the model sees them
Each result's text is cut to ~700 characters at a sentence boundary. With 5 results × 4 queries
that is at most ~14k characters per call, which keeps the model fast and cheap. The full raw results
are kept in the `searches` table.

### 6. A 10-minute cache
Key = sha256 of the normalised query (lowercase, collapsed spaces) + `since` + `topic`. Repeats
and follow-ups within 10 minutes cost nothing and return instantly. The TTL is short because
freshness is the point of searching. Expired rows are pruned on write.

### 7. Failure handling: degrade, never crash
- An 8 s timeout per query (combined with the request's abort signal, so Stop cancels searches).
- Some queries fail → return what worked, plus `failedQueries`.
- All fail → `{ error: "Web search is unavailable right now…" }`. No key → a "not configured" message.
- The prompt makes the model say it couldn't verify, then answer from its own knowledge, clearly
  marked as possibly out of date. Verified live: with no key, it declined to guess a race winner
  and pointed to the official results page.

### 8. Snapshots are saved with the answer, atomically
`searches.message_id` references the assistant message, which doesn't exist until the answer
finishes. Searches are buffered per turn and written in the same transaction as the answer.

### 9. Step cap
At most 5 model steps per turn (`stopWhen: stepCountIs(5)`), which caps latency and cost if the
model keeps searching.

## Consequences
- The model decides by itself when to search in Phase 1. From Phase 3 the planner also prefetches
  searches before the model starts, through the same `runWebSearch` function.
- Tavily only returns publish dates for `topic: "news"`. For general results the model relies on the
  page text, and the prompt asks it to state how fresh a fact is.
