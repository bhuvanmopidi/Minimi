# 0015: Fresh-install behaviour and end-to-end evals

**Status:** Accepted (Phase 6)

## Context
Reviewers will "chat like a real user", most likely on a fresh install with no history, asking the
brief's questions one after another. That case had never been tested.

## What the test found, and the fixes

### 1. False "found" across chats (bug)
Asking the three brief questions in three new chats, the Postgres question reported "found 2
conversations": the two CRM chats from minutes earlier, matched only by the generic word "pricing".
- **Fix:** evidence must match the scope. Inside a named day, one keyword is enough (the date already
  narrows it down). **Across all dates, a conversation must match at least two distinct keywords.**
- Words that describe the question rather than its topic ("answer", "correct", "changed", "remember"…)
  are no longer keywords.
- Regression tests reproduce the live case.

### 2. Asking instead of helping (weak spot)
With no record, the agent said "tell me the tools and I'll check", then stopped.
- **Fix (structural, not just prompt):** on a re-check the planner always adds 1–2 general searches on the
  topic's recent changes, because the earlier conversation may not exist. The prompt says: one sentence
  saying there is no record, then a useful fresh snapshot (clearly framed as new, not a comparison), then ask
  for the specifics.
- A prompt-only fix was tried first and wasn't enough: with no history there were no recorded facts, so
  nothing had been searched, and the model had nothing to help with.

## End-to-end evals (`npm run eval`)
**Options:** unit tests only (they already cover dates, retrieval and planning with fakes), a hand-checked
transcript, or **black-box evals against the running app (chosen)**.

The script talks to the app over HTTP like a user, with its own anonymous users (a "seeded" one with demo
history and a "fresh" one), so it never touches the reviewer's chats. Each case gets:
- **hard checks:** memory found / not found, number of searches, citations present, time to first word;
- **an LLM judge** (Haiku, thinking off) grading against a plain-English rubric. The judge sees exactly
  what the user sees: the answer, the *cited* sources, and (for the seeded user) the stored history.

Building the judge taught three things, recorded so the results can be trusted:
1. With default thinking, Haiku used up its small output budget and returned nothing.
2. Without the stored history, it marked correct recall ("10:15", the old prices) as invention.
3. Shown *all* search results, it penalised irrelevant ones the answer never cited.

The judge was told to grade only the rubric, and the run is reported as-is (9/10), not tuned to 10/10.

## Consequences
- Re-checks run 1–2 extra news searches, which costs a little time. News searches sometimes return
  unrelated headlines, which the model ignores. A relevance filter is listed under "another week".
- Results are written to [evals/latest.md](../../evals/latest.md) on each run.
