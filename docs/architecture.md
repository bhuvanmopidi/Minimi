# Architecture

This document follows **one user message** through the system from start to end. Each stage notes
the phase that builds it, so you can tell what exists today and what is still planned.

Running example (user in Asia/Kolkata, Wed 11 Nov 2026, 3:30 pm):
> "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"

## The flow at a glance

```
BROWSER   ① sends {conversationId, message, timeZone, locale}
             │
SERVER    ② identify user (cookie) + conversation                     Phase 0 ✅
          ③ save the user message immediately                          Phase 0 ✅
          ④ load recent turns (+ summary of older ones)                Phase 0 ✅ / 4 ✅
          ⑤ date candidates (chrono-node, locale-aware)                Phase 2 ✅
          ⑥ plan: ONE Haiku call → JSON plan (calls nothing)           Phase 2 ✅ / 3 ✅ (intent, searches, title)
          ⑦ validate dates in code                                     Phase 2 ✅
          ⑧ history, then searches before the answer:                  Phase 3 ✅
               ├─ history lookup across ALL past chats (SQLite FTS5)   + the facts each old answer recorded
               └─ web searches (Tavily, cached, parallel)              planner's + one per recorded fact on a re-check
          ⑨ build context (rules + dates + history + claims + sources)
          ⑩ Sonnet streams the answer; may call web_search again       Phase 1 ✅
          ⑪ stream status → sources → text to the browser              Phase 1 ✅
          ⑫ save the answer + searches                                 Phase 1 ✅
          ⑬ background: extract claims, update summary (Haiku)         Phase 3 ✅ / 4 ✅
```

## Stage by stage

### ① Request (browser → `POST /api/chat`)
```json
{ "conversationId": "conv_7a1c…", "message": { "text": "Last Tuesday I asked…" },
  "timeZone": "Asia/Kolkata", "locale": "en-IN" }
```
The browser sends **only the new message**. The server is the source of truth for history
([ADR-0007](decisions/0007-server-owns-history.md)). Timezone and locale come from the browser's `Intl` API.

### ② Identity and conversation
- An anonymous `minimi_uid` cookie identifies the browser ([ADR-0009](decisions/0009-anonymous-identity.md)).
- The conversation is created on first use. A conversation id that belongs to another user is rejected (404).

### ③ Save the user message first
Saved before any model work, so a failed generation never loses what the user typed.
Times are stored in UTC together with the user's timezone, so "3 November" can later be matched
against the user's *local* day.

### ④ Load context
The last 12 messages of the conversation, oldest first, always starting at a user message. The
last 3 answers carry the URLs of the sources they cited. Older messages are folded into a rolling
summary (≤250 words) that is updated in the background ([ADR-0013](decisions/0013-robustness-long-chats.md)).

### ⑤ Date candidates (code)
chrono-node finds date expressions and turns them into candidate dates. It uses the locale to read
numeric dates (day-first for en-IN/en-GB, month-first for en-US). Ambiguous expressions keep both
readings: `"last Tuesday"` → 10 Nov or 3 Nov; `"3-10-26"` → 3 Oct or 10 Mar.
See [ADR-0005](decisions/0005-date-handling.md).

### ⑥ Plan (one Haiku call)
Haiku receives the message, now/timezone/locale, a 6-week mini calendar, chrono's candidates and the
recent turns. It returns one JSON plan and **calls nothing** ([ADR-0002](decisions/0002-plan-then-execute.md)):
```json
{ "intent": "recheck",
  "needsHistory": true, "history": { "query": "Postgres hosting pricing" },
  "needsSearch": true,  "searches": [{ "query": "Postgres hosting pricing changes", "since": "2026-11-03", "topic": "news" }],
  "dates": [{ "text": "Last Tuesday", "choice": "candidate", "index": 0, "confidence": "medium" }],
  "title": "Postgres pricing re-check" }
```
The planner alone decides whether history is needed ([ADR-0004](decisions/0004-when-to-use-history.md)).

### ⑦ Validate dates (code)
For text chrono already parsed, the planner may only **pick** a candidate or mark it **not a date**.
It writes its own date only when chrono found nothing (fuzzy or contextual phrases). Code checks
those dates: is it real, is it in the past, is it in a sane window, does the weekday match? If a check
fails, code falls back to chrono's candidate, or tells the model the date is unresolved so it asks the user.

### ⑧ Fan-out (parallel)
- **History**: FTS5 keyword match + date range + user id, across all past conversations, in three
  modes (topic + date, date only, topic only), trying alternative readings and then "same topic,
  other date" ([ADR-0011](decisions/0011-memory-recall.md)). Then the claims stored for the matched
  answers ([ADR-0006](decisions/0006-claims-ledger.md), Phase 3). Nothing found → an explicit
  `not_found`, plus the nearest conversations ([ADR-0003](decisions/0003-memory-is-orchestration.md)).
- **Web**: one Tavily call per planned query, all at once, cached for 10 minutes. Results are
  trimmed and numbered in a per-turn source registry, so citation numbers stay stable.
  Details: [ADR-0010](decisions/0010-web-search-tool.md).

### ⑨ Context for the main model
A fixed system prompt (byte-identical across turns, so it's prompt-cached together with the tool
definition) + the conversation + a per-turn context block, capped in size:
```xml
<now>…</now> <earlier_in_this_conversation>…</earlier_in_this_conversation>
<intent>recheck</intent> <resolved_dates>…</resolved_dates>
<history status="found"> …what the user asked, what we answered, the claims… </history>
<search_results> [1] … [2] … </search_results>
```

### ⑩ Answer (Sonnet, reasoning effort `medium`)
Sonnet streams the answer. It has exactly one tool, `web_search({queries[1..4], since?, topic?})`,
and may use it for up to ~4 extra steps (a small ReAct loop). The searches run before the answer
usually cover it in one step. For re-check questions it gives each recorded fact exactly one status:
**Changed / Unchanged / Couldn't verify / Correction** ([ADR-0012](decisions/0012-recheck-prefetch-effort.md)).
Every turn logs one `[turn]` line with per-stage timings (planner, prefetch, first token, steps).

### ⑪ Stream to the browser
One stream carries status lines, sources, tool activity and text, rendered as each arrives.

### ⑫ Save the answer
The assistant message is saved with its full `parts_json` (so a reopened chat looks the same), plus
an `aborted` flag if the user pressed Stop. **Stop really stops**: the model and searches are
cancelled and the partial answer is saved. **Retry** reuses the stored question and replaces a
partial answer. Provider errors are retried twice, then shown as a short actionable message.

### ⑬ Background work
Haiku extracts structured claims from the answer into the ledger, so future "has it changed?"
questions have something exact to compare against. Long chats get a rolling summary.

## Data model (SQLite)

| Table | Purpose |
|---|---|
| `conversations` | id, user_id, title, summary, timestamps |
| `messages` | role, content, parts_json, tz, aborted, created_at (UTC) |
| `messages_fts` | FTS5 full-text index over message content, kept in sync by triggers |
| `searches` | snapshot of every web search: query, since, results, fetched_at |
| `claims` | the claims ledger: entity, attribute, value, source_url, source_date, asserted_at |
| `search_cache` | short-lived cache of Tavily results |

Migrations are an ordered, append-only list in [src/memory/db.ts](../src/memory/db.ts), tracked with
SQLite's `user_version`.
