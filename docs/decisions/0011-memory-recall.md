# 0011: Memory recall. Phase order, history search, and the demo loader

**Status:** Accepted (Phase 2)

## 1. A planner-lite moved into Phase 2

### Context
History search was planned for Phase 2 and the planner for Phase 3. But the planner is the only
thing that decides when history is needed ([0004](0004-when-to-use-history.md)), so after Phase 2
the search would exist with nothing to trigger it.

### Options
- **Keep the order.** ➖ Memory could not be tried in the chat until Phase 3.
- **Merge Phases 2 and 3.** ➖ One very large review, and problems found late.
- **Planner-lite in Phase 2 (chosen).** The planner decides `needsHistory`, `historyQuery` and date
  meanings now. Search prefetch and the claims ledger stay in Phase 3.

### Consequence
Each phase ends with something you can try: Phase 2 answers "What did I ask you on 3 November?";
Phase 3 makes "has it changed since?" precise.

## 2. History search has three modes

The brief's examples need all three:

| User says | Mode | Search |
|---|---|---|
| "Last Tuesday I asked about Postgres" | topic + date | FTS5 keyword match **within** that day |
| "What did I ask you on 3 November?" | date only | every question the user asked that day |
| "the CRM tools we discussed" | topic only | best keyword matches, any date |

Order of attempts:
1. The planner's chosen readings.
2. The alternative readings ("last Tuesday" → the week before).
3. With topic + date and still nothing, the topic on **any** date, flagged `otherDate`, so the agent
   can say "I found it, but on Wednesday, not Tuesday". People misremember days.

When nothing is found, the result is an explicit `not_found` plus the **nearest** conversations in
time, so the agent can offer them instead of inventing one ([0003](0003-memory-is-orchestration.md)).

Results are grouped into *exchanges* (the user's question + the answer that followed, cut to 700
characters), at most 3 conversations × 3 exchanges. Turns already in the model's context are excluded.

*Considered:* returning raw matching messages. ➖ A match in an answer without its question (or
the reverse) is hard for the model to use.

## 3. Refinement of the date disagreement rule
[0005](0005-date-handling.md) says the planner may only write its own date when chrono found nothing.
In practice "the Monday **after that**" contains "Monday", which chrono does parse. So the rule
was made precise:
- **Same text** as a chrono match → chrono's readings only. The planner can pick or reject, never retype.
- **A longer phrase that wraps a chrono match** → context, which is the planner's job. Its own date
  is used (after validation) and the inner chrono match is set aside.

Also found while testing: chrono reads `3/10/26` but not `3.10.26`, so dots between short numeric
dates are swapped for slashes before parsing. Lookalikes such as version numbers then become
candidates, which the planner rejects as `not_a_date`.

## 4. Planner fallback
If the planner call fails (6 s timeout, or invalid output), history is searched with the user's own
words and chrono's default readings, and the context marks the match as *automatic: may be
unrelated*. This is a safety net, not a second decider. The planner did not fall back once in live testing.

## 5. Demo history: a button, not `npm run seed`

### Context
Testing "What did I ask you on 3 November?" needs chats dated 3 November.

### Options
- **`npm run seed` script (planned).** ➖ Chats belong to the browser's anonymous id, which is in an
  httpOnly cookie a terminal script can't read.
- **A "Load demo chats" button + `POST /api/demo` (chosen).** It runs in the browser, so the chats
  belong to that browser automatically.

### Decision
Three demo conversations, titled "Demo · …", only created when the button is clicked. Reloading
replaces them. **Dates are relative to today:** the CRM chat on the most recent Monday and the
Postgres chat on the Tuesday of the week before, so the brief's example questions always line up,
including the "last Tuesday" ambiguity.

## 6. The context block is never stored
Dates and history are attached to the latest user message for the model only. The stored
conversation stays exactly what the user typed, and the block is rebuilt fresh on every turn.
