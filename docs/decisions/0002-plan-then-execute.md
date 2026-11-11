# 0002: Plan-then-execute pre-step instead of a ReAct agent

**Status:** Accepted

## Context
Before answering, the agent has to decide whether it needs past conversations and which web
searches to run. The usual pattern is a ReAct loop: the LLM thinks, calls a tool, waits, reads the
result, thinks again.

## Options

**A. ReAct for everything.** The LLM calls a history tool, waits, then calls search, waits, then answers.
- ➖ Slow: each step waits for the one before, so there are 2–3 LLM round-trips before the answer starts.
- ➖ Needs a second tool for history, which conflicts with the brief ("it has one tool: web search").

**B. Plan-then-execute (chosen).** One fast LLM call (Haiku) returns a JSON plan. Our code runs
the history lookup and all web searches **in parallel**. The main model then answers with
everything already in front of it.
- ➕ One small LLM decision (~400 ms), then parallel I/O.
- ➕ The main model keeps exactly one tool.
- ➖ One extra (cheap) model call per message.

## Decision
B. The planner (Haiku) only **decides**; it calls nothing. The main model (Sonnet) still has a
small ReAct loop with `web_search` as its one tool, for follow-up searches when the planned ones
were not enough.

If the planner returns invalid JSON, we fall back to searching the user's text as-is with no history.

## Consequences
- The plan is a typed, validated object, so it is visible in logs and testable in evals.
- Every message goes through the planner, including small talk. A small-talk shortcut was
  considered and rejected to keep one consistent path (see [0004](0004-when-to-use-history.md)).
