# 0003: Memory is orchestration, not a second tool; honest "no record"

**Status:** Accepted

## Context
The sample questions in the brief are memory questions anchored in time ("What did I ask you on
3 November?"). The agent needs past conversations, but the brief gives it **one tool: web search**.

## Options
- **A `recall_history` tool for the model.** ➖ Breaks the one-tool rule. ➖ Adds a model round-trip.
- **Orchestration (chosen).** History is fetched by our code, guided by the planner, and placed in
  the model's context before it starts.

## Decision
History retrieval is part of the orchestration. The model never "calls" memory. It is handed
the relevant past turns and claims.

**No invented history.** When retrieval finds nothing, that is passed to the model as an
explicit fact (`<history status="not_found" nearest="…"/>`). The prompt requires the model to say
so, mention the nearest conversation it does have, and still answer the useful part of the question.

## Consequences
- The model keeps exactly one tool.
- "I have no record of that" is a deliberate, tested behaviour, not something the model must notice
  by itself. A made-up past conversation is the worst failure for this kind of agent.
