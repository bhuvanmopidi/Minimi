# 0004: The planner alone decides whether history is needed

**Status:** Accepted

## Context
Searching past conversations when it is not needed brings in noise. Skipping it when it is needed
gives a bad answer ("I don't know what you asked"). Something has to decide.

## Options considered
1. **Regex keyword triggers** ("I asked you", "last time", "still correct", date words) that force a lookup.
2. **The planner LLM** returns `needsHistory` as part of its plan.
3. **An always-on "peek"**: a quick database search on every message using its main nouns, kept only on
   a strong match. This would let the agent say, unprompted, "Neon is $15 now; when you asked on
   3 Nov I said $19".
4. **A small-talk shortcut**: skip the planner entirely for "hi" / "thanks".

## Decision
**Only option 2.**
- Regex (1) was rejected: brittle (typos, rephrasing), duplicates what the planner already does,
  and saves no time because the planner runs anyway.
- The peek (3) was deferred. It is more a feature than a check, and needs a tuned match
  threshold to avoid noise. It is listed under "what I'd do with another week".
- The small-talk shortcut (4) was rejected: it saves ~0.4 s on trivial messages but is regex again
  and adds a second path. Every message goes through the planner.

## Consequences
- One decision-maker, one code path, easy to explain and evaluate.
- History quality depends on the planner prompt, so the Phase 6 evals cover implicit cases
  ("which of those is cheapest now?") as well as explicit ones.
