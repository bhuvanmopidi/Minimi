# Phase 4: Robustness, long chats and caching

**Goal:** behave well when things go wrong, stay fast and cheap in long conversations, and stop
paying for text the user didn't want. Design: [ADR-0013](../decisions/0013-robustness-long-chats.md).

## What was built

| File | What it does |
|---|---|
| [src/agent/orchestrator.ts](../../src/agent/orchestrator.ts) | Stop + 90 s turn limit wired through planner check, prefetch and the model; cached system prompt; summary in context; retries; friendly errors; cache usage in the `[turn]` log |
| [src/agent/errors.ts](../../src/agent/errors.ts) | Provider errors → short, actionable messages (no internals leaked) |
| [src/agent/summarize.ts](../../src/agent/summarize.ts) | Incremental rolling summary of messages outside the window (Haiku, background) |
| [src/agent/history.ts](../../src/agent/history.ts) | Stored messages → model messages: window starts with a user turn, cited sources on the last 3 answers, context on the latest message |
| [src/agent/context.ts](../../src/agent/context.ts) | `<now>` (moved out of the system prompt), `<earlier_in_this_conversation>`, search-results budget |
| [src/agent/prompts.ts](../../src/agent/prompts.ts) | Fully static `SYSTEM_PROMPT` (cacheable) |
| [src/memory/repo.ts](../../src/memory/repo.ts) | `prepareRetry`, `getSummary` / `saveSummary`, `allMessages` |
| [src/memory/db.ts](../../src/memory/db.ts) | Migration 2: `conversations.summary_through` |
| [src/app/api/chat/route.ts](../../src/app/api/chat/route.ts) | `retry` flag; passes the request's abort signal |
| [src/components/ChatView.tsx](../../src/components/ChatView.tsx) | ↻ Retry button, "Stopped" label (also on reopened chats) |
| [tests/robustness.test.ts](../../tests/robustness.test.ts) | 17 tests: model-message building, cited sources, retry cases, summary (no-op, incremental, no gap), error mapping, context budget |

## Bug fixed along the way
The 12-message window could start with an **assistant** message once a chat was longer than 12
messages, which the Anthropic API rejects. The window now always starts at a user message.

## How it was checked
- `npm run typecheck`: clean. `npm test`: 94/94.
- **Live:**

| Check | Result |
|---|---|
| Stop during a long answer | Partial answer saved with `aborted = 1`; no `[turn]` finish line, so the model call ended |
| Retry after Stop | Partial replaced; the conversation is `[user, assistant]`, with no duplicate question |
| "What was the URL of source [1] in your last answer?" | Correct URL from the previous answer's sources |
| 27-message chat, then "how many engineers / budget / cloud?" | Summary kept Brightloom · 14 engineers · $3,000/month · AWS only; answered correctly |
| Prompt caching | `cache_read=1782` tokens on every turn |

## Not done (by decision)
- Speculative search during planning: rejected in review (spends a search on every message).
