# Build phases

The agent is built in phases. Each one ends with a review, a commit and a push.

| Phase | Scope | Status |
|---|---|---|
| [0](phase-0-scaffold.md) | Scaffold: Next.js, database schema, server-owned history, streaming chat | ✅ Done |
| [1](phase-1-search.md) | Tavily `web_search` tool, multi-step loop, citations, live search status | ✅ Done |
| [2](phase-2-memory.md) | Date module, planner-lite (history + dates), cross-chat recall, "no record" handling, sidebar, demo chats | ✅ Done |
| [3](phase-3-recheck.md) | Claims ledger, searching before the answer, fixed per-fact statuses, titles, reasoning effort | ✅ Done |
| [4](phase-4-robustness.md) | Real Stop, Retry, friendly errors, rolling summary, sources of past answers, context budget, prompt caching | ✅ Done |
| [5](phase-5-ui.md) | Markdown, citation chips, compact searches + cited sources, timestamps and date dividers, input comforts | ✅ Done |
| [6](phase-6-ship.md) | Fresh-install fixes (false matches, help-first), `npm run eval`, `DESIGN.md`, fresh-clone check | ✅ Done |

Phase 2 took over the planner's history and date decisions and the demo data from later phases.
See [ADR-0011](../decisions/0011-memory-recall.md).
