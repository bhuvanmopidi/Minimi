# Build phases

The agent is built in phases. Each one ends with a review, a commit and a push.

| Phase | Scope | Status |
|---|---|---|
| [0](phase-0-scaffold.md) | Scaffold: Next.js, database schema, server-owned history, streaming chat | ✅ Done |
| [1](phase-1-search.md) | Tavily `web_search` tool, multi-step loop, citations, live search status | ✅ Done |
| [2](phase-2-memory.md) | Date module, planner-lite (history + dates), cross-chat recall, "no record" handling, sidebar, demo chats | ✅ Done |
| [3](phase-3-recheck.md) | Claims ledger, searching before the answer, fixed per-fact statuses, titles, reasoning effort | ✅ Done |
| 4 | Rolling summaries, context budgets, prompt caching, error handling, latency logging | Planned |
| 5 | UI polish: markdown, sources panel, timestamps | Planned |
| 6 | Evals, `DESIGN.md`, final README, public repo | Planned |

Phase 2 took over the planner's history and date decisions and the demo data from later phases.
See [ADR-0011](../decisions/0011-memory-recall.md).
