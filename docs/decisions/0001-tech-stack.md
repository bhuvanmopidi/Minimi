# 0001: Tech stack

**Status:** Accepted. The Tavily *SDK* detail was replaced by a direct REST client in [0010](0010-web-search-tool.md) (Phase 1); Tavily itself stays.

## Context
The challenge requires JavaScript/TypeScript on Node, `npm install && npm run dev`, and every API key
listed in `.env.example`. Reviewers will chat with the agent in a browser and read the code, so the
stack should be quick to start and easy to follow.

## Options and choice

| Layer | Considered | Chosen | Why |
|---|---|---|---|
| App shape | Next.js full-stack · Fastify API + Vite React · terminal CLI | **Next.js 15 (App Router)** | One process, one command, streaming API routes. A CLI would be faster to build, but reviewers will expect a browser chat |
| LLM | Anthropic · OpenAI · provider-agnostic | **Anthropic: Sonnet 5.5 (answers) + Haiku 5.5 (side jobs)** | Strong tool use and citation behaviour. Haiku is fast and cheap for planning and extraction. Models can be swapped with `MAIN_MODEL` / `FAST_MODEL` |
| Agent runtime | Vercel AI SDK · raw Anthropic SDK · LangChain/LangGraph | **Vercel AI SDK v5** | Streaming, tool-call parts, multi-step loop and the `useChat` hook for free, while the orchestration stays our own. LangChain was rejected as opaque and hard to explain |
| Search | Tavily · Exa · Brave · the model's built-in search | **Tavily** | Returns cleaned page content for LLMs, plus date and news filters (`start_date`, `topic: news`) needed for "since Monday". Brave returns only snippets. Built-in search gives no control over date filters or caching |
| Storage | SQLite · Postgres · JSON files | **SQLite (better-sqlite3) + FTS5** | No setup for reviewers, real SQL, built-in full-text search. See [0008](0008-storage-sqlite-fts.md) |
| Validation | zod | **zod** | One schema library for requests, tool inputs and LLM structured output |
| Dates | chrono-node | **chrono-node** + `Intl` | See [0005](0005-date-handling.md) |
| Tests | vitest | **vitest** + a scenario eval script (Phase 6) | Fast, TypeScript-native |

## Consequences
- Two API keys are needed: Anthropic and Tavily.
- `better-sqlite3` is a native module. It ships prebuilt binaries for common platforms (verified on
  Windows with Node 24), and Next.js is told not to bundle it (`serverExternalPackages`).
