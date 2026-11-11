# Phase 2: Memory across conversations

**Goal:** the agent remembers past chats and answers questions anchored in time:
*"What did I ask you on 3 November?"*, *"Last Tuesday I asked about Postgres hosting…"*. It says so
honestly when there is no such chat.

Design: [ADR-0005](../decisions/0005-date-handling.md) (dates), [ADR-0011](../decisions/0011-memory-recall.md) (recall).

## How a memory question flows now

```
"Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"
  │
  ├─ chrono (code):    "Last Tuesday" → reading 0: Tue 10 Nov | reading 1: Tue 3 Nov
  ├─ planner (Haiku):  needsHistory ✓ · historyQuery "postgres hosting pricing" · picks a reading
  ├─ validate (code):  checks the planner's choices, local days → UTC ranges
  ├─ UI status:        "Checking your conversations from Tuesday 3 November 2026…"
  ├─ history (SQLite): topic + date → the 3 Nov exchange (question + answer)
  ├─ context block:    <resolved_dates> + <history status="found"> attached for the model only
  └─ Sonnet:           re-checks with web_search(since: 2026-11-03), compares, cites
```

## What was built

| File | What it does |
|---|---|
| [src/time/zone.ts](../../src/time/zone.ts) | Calendar-day maths and timezone conversion (DST-safe), stable date labels |
| [src/time/candidates.ts](../../src/time/candidates.ts) | Code proposes: chrono with a locale-aware day/month order, both readings for ambiguous dates, weeks and months as ranges, future readings pulled into the past |
| [src/time/calendar.ts](../../src/time/calendar.ts) | The 6-week calendar the planner looks weekdays up in |
| [src/time/validate.ts](../../src/time/validate.ts) | Code validates: pick / not_a_date / own, the disagreement rule, checks on the planner's own dates, local day → UTC range |
| [src/agent/planner.ts](../../src/agent/planner.ts) | Planner-lite: one Haiku structured call → `needsHistory`, `historyQuery`, date decisions; 6 s timeout; safe fallback |
| [src/memory/retrieval.ts](../../src/memory/retrieval.ts) | History search: three modes, alternative readings, other-date match, not found + nearest, exchanges, user isolation |
| [src/agent/context.ts](../../src/agent/context.ts) | Renders the `<context>` block (dates, history) attached to the latest message, never stored |
| [src/agent/orchestrator.ts](../../src/agent/orchestrator.ts) | One turn end to end (moved out of the route), with a live memory status written to the stream before the answer |
| [src/agent/prompts.ts](../../src/agent/prompts.ts) | Memory rules: use resolved dates, say the date in words, never invent history, re-check old answers with `since` |
| [src/memory/demo.ts](../../src/memory/demo.ts) + `POST /api/demo` | "Load demo chats": three labelled conversations dated relative to today |
| `GET /api/conversations`, `GET /api/conversations/[id]` | Sidebar list; reopen a chat with its sources (from `parts_json`); other users get 404 |
| [src/components/](../../src/components/) | `App` (sidebar + chat), `Sidebar`, `ChatView`, `MemoryStep` ("Checking… → Checked…: found 1") |
| tests | `dates` (34), `retrieval` (11), `planner` (8): 66 tests in total |

## Changes from the plan
- **Planner-lite moved into Phase 2** so memory works now ([ADR-0011 §1](../decisions/0011-memory-recall.md)).
- **"Load demo chats" button instead of `npm run seed`**, because the chats must belong to the browser's cookie id (§5).
- **Disagreement rule made precise** for phrases like "the Monday after that" (§3).
- Date labels are built from parts, because `Intl` punctuation differs between Node/ICU versions
  ("Tuesday, 3 November" vs "Tuesday 3 November"), which broke tests on one machine.

## How it was checked
- `npm run typecheck`: clean. `npm test`: 66/66.
- **Live (real Claude + Tavily, demo chats loaded, today = Wed 11 Nov 2026, Asia/Kolkata):**

| Question | Result |
|---|---|
| "What did I ask you on 3 November?" | Found the Postgres chat, quoted the question and the answer with date and time · 4.7 s |
| "What did I ask you on 5 November?" | "I have no conversation from Thursday 5 November 2026", then offered the nearest two (3 Nov, 9 Nov). Nothing invented · 4.7 s |
| "What's the capital of Australia?" | No history looked up (planner said no) · 3.0 s |
| "Last Tuesday I asked about Postgres hosting. Has any pricing changed since then?" | Matched 3 Nov, searched each provider `since: 2026-11-03`, table of then vs now with status per provider · 17 s |
| "On Monday we shortlisted 5 CRM tools… changed pricing or shipped something big since?" | Matched 9 Nov, 4 parallel queries since 9 Nov. It found no changes after Monday, but caught errors in the old answer (Attio's price, Pipedrive's plan names) · 22 s |
| "What did I ask you on 3 November? Is your answer still correct today?" | Recalled the question, re-checked it, and gave a verdict per provider · 15 s |

- Reopening a chat returns its messages with their parts. Another browser gets 404.
- Planner fallbacks during live testing: 0.

## Known limits (next phases)
- **Re-check questions take 15–22 s**: planner, then the model decides to search, then reads, then
  sometimes searches again. Phase 3 prefetches the planner's searches in parallel with the history lookup.
- **Re-checks compare against old prose**, so two runs can label the same fact differently (Neon was
  "not a new change" in one answer and "changed" in another). Phase 3's claims ledger gives a precise,
  structured comparison.
- Answers are plain text; markdown rendering comes in Phase 5.
