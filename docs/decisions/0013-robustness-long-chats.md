# 0013: Robustness, long conversations and prompt caching

**Status:** Accepted (Phase 4)

## 1. Stop really stops
**Options:** (a) keep generating in the background after Stop, so the full answer is saved anyway;
(b) **cancel the model and searches, and save the partial answer (chosen).**
(a) pays for text the user explicitly didn't want. The request's abort signal now reaches the planner
check, the prefetch searches and `streamText`. The partial answer is saved with `aborted = 1` and
shown as "Stopped", including when the chat is reopened. Claims are not extracted from stopped answers.

Verified live: the stopped request never reached the model's finish handler (no `[turn]` line),
and the partial text was saved and marked aborted.

## 2. Retry without duplicates
The UI shows **↻ Retry** after an error or a Stop. It resends with `retry: true`, and the server
(`prepareRetry`) reuses the stored question. If a partial answer to it was saved, that answer is
deleted (its searches and claims cascade) so the retry replaces it. If the conversation doesn't
end with that question, it's treated as a normal send. A retry can never corrupt history.

## 3. Errors the user can act on
`streamText` retries twice with backoff (`maxRetries: 2`) before anything reaches the user. After
that, `friendlyError` maps the cause (looking inside `RetryError`) to a short message:
429 → rate-limited, 529/503 → overloaded, 401/403 → bad API key, 5xx → temporary, timeout → narrower
question. Anything else gets a generic message. **Internal details stay in the server log.**

A hard **90 s limit per turn** (`turnTimeoutMs`) is combined with the Stop signal; whatever was
written before it is kept.

## 4. Long conversations: rolling summary
**Options:** (a) send the whole conversation every turn: cost and latency grow without bound;
(b) a fixed window only: early facts ("we have 14 engineers") are forgotten;
(c) **window + rolling summary (chosen).**

The model reads the last 12 messages plus `<earlier_in_this_conversation>`: a summary of at most
250 words of everything older, written by Haiku **in the background** after each answer. It is
incremental: the previous summary plus only the newly dropped messages, tracked by
`conversations.summary_through` (migration 2). Two messages of slack mean the summary and the next
turn's window never leave a gap. Older messages also stay findable by history search, which only
excludes the current window.

Verified live: in a 27-message chat, the summary kept "Brightloom, 14 engineers, $3,000/month, AWS only",
dropped the filler, and a later recall question was answered correctly from it.

## 5. Sources of earlier answers stay visible
Past answers used to reach the model as plain text, so "what was source [3]?" failed. The last 3
answers now carry a compact list of the sources their `[n]` citations point at, parsed from the saved
`parts_json` (both tool calls and searches run before the answer). Only *cited* sources, max 8 per answer.

## 6. Context budget
Prefetched search results are capped at ~14k characters (about 3.5k tokens), keeping the best-ranked
first. Together with the existing caps (3 conversations × 3 exchanges, 700-character excerpts,
a 250-word summary, a 12-message window) the context stays bounded however long the history grows.

## 7. Prompt caching
The current date moved from the system prompt into the `<context>` block, which makes the system
prompt **byte-identical across turns and users**. A cache breakpoint after it covers the tool
definition and the system prompt (1,782 tokens). Verified live: `cache_read=1782` on every turn.
Planner and extraction prompts are below Haiku's minimum cacheable size, so they aren't cached.

## Rejected: speculative search while the planner runs
Searching the raw user message in parallel with the planner would save ~1.5 s on search
questions, but it spends a Tavily search on *every* message ("hi", recall questions…) and is often
wasted. Rejected in review; `medium` effort had already brought simple re-checks to ~4 s.

## Consequences
- One more background Haiku call per turn, only on chats longer than the window.
- Each turn logs `[turn] … tokens_in cache_read cache_write`, so caching regressions are visible.
