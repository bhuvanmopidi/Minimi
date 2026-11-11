# Build phases

The agent is built in phases. Each one ends with a review, a commit and a push.

| Phase | Scope | Status |
|---|---|---|
| [0](phase-0-scaffold.md) | Scaffold: Next.js, database schema, server-owned history, streaming chat | ✅ Done |
| [1](phase-1-search.md) | Tavily `web_search` tool, multi-step loop, citations, live search status | ✅ Done |
| 2 | Saved conversations sidebar, date module (chrono + calendar + validator), cross-chat recall, "no record" handling | Planned |
| 3 | Haiku planner, parallel fan-out, claims ledger, "what changed" comparison | Planned |
| 4 | Rolling summaries, context budgets, prompt caching, error handling, latency logging | Planned |
| 5 | UI polish: markdown, sources panel, timestamps, `MOCK_NOW` + `npm run seed` demo | Planned |
| 6 | Evals, `DESIGN.md`, final README, public repo | Planned |
