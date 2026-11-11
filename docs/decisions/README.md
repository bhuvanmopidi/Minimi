# Decision records

Each record covers one decision: the problem, the options we considered, what we chose and why,
and what it costs us. All of them were discussed and agreed before any code was written (11 Nov 2026).

| # | Decision | Status |
|---|---|---|
| [0001](0001-tech-stack.md) | Tech stack: Next.js, Vercel AI SDK, Claude, Tavily, SQLite | Accepted |
| [0002](0002-plan-then-execute.md) | Plan-then-execute pre-step instead of a ReAct agent | Accepted |
| [0003](0003-memory-is-orchestration.md) | Memory is orchestration, not a second tool; honest "no record" | Accepted |
| [0004](0004-when-to-use-history.md) | The planner alone decides whether history is needed | Accepted |
| [0005](0005-date-handling.md) | Dates: code proposes, LLM picks, code validates | Accepted |
| [0006](0006-claims-ledger.md) | A claims ledger for "what changed since" questions | Accepted |
| [0007](0007-server-owns-history.md) | The server owns conversation history | Accepted |
| [0008](0008-storage-sqlite-fts.md) | SQLite + FTS5, no vector database | Accepted |
| [0009](0009-anonymous-identity.md) | Anonymous per-browser identity | Accepted |
| [0010](0010-web-search-tool.md) | Web search tool design: parallel queries, advanced depth, fetch client, citations, cache, failures | Accepted (Phase 1) |
| [0011](0011-memory-recall.md) | Memory recall: planner-lite in Phase 2, three search modes, date-rule refinement, demo loader | Accepted (Phase 2) |

Format: *Context → Options → Decision → Consequences.* A changed decision gets a new record that
supersedes the old one. Old records are not rewritten.
