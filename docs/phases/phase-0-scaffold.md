# Phase 0: Scaffold

**Goal:** a running app with the final request shape and database in place, so later phases only
add behaviour. No web search yet.

## What was built

| File | What it does |
|---|---|
| [src/app/api/chat/route.ts](../../src/app/api/chat/route.ts) | The agent endpoint. Validates `{conversationId, message, timeZone, locale}`, sets the anonymous user cookie, rejects other users' conversations, saves the user message first, loads the last 12 turns, streams Sonnet, and saves the answer (with `parts_json` and an `aborted` flag) when the stream ends |
| [src/memory/db.ts](../../src/memory/db.ts) | SQLite connection plus append-only migrations: `conversations`, `messages` (+ FTS5 index and triggers), `searches`, `claims`, `search_cache` |
| [src/memory/repo.ts](../../src/memory/repo.ts) | Typed SQL functions: get-or-create conversation (with ownership check), insert message, recent messages |
| [src/memory/ids.ts](../../src/memory/ids.ts) | Readable prefixed ids (`conv_…`, `msg_…`, `usr_…`) |
| [src/config.ts](../../src/config.ts) | All environment variables in one place, with readable errors when a key is missing |
| [src/time/clock.ts](../../src/time/clock.ts) | `now()` (respects `MOCK_NOW`), timezone/locale checks, "now" formatted in the user's timezone |
| [src/agent/prompts.ts](../../src/agent/prompts.ts) | System prompt: fixed answer-style rules first (cacheable), current date/time last |
| [src/components/Chat.tsx](../../src/components/Chat.tsx) | Chat UI. Sends only the new message plus timezone and locale; streaming, Stop, New chat |
| [tests/memory.test.ts](../../tests/memory.test.ts) | Migrations, full-text search, ownership check, recent-turn order |

## Changes from the original plan
- **Server-side history loading moved here from Phase 2.** The agreed request shape (client sends only
  the new message, [ADR-0007](../decisions/0007-server-owns-history.md)) can't work without it.
- **The schema is TypeScript migrations, not a `schema.sql` file.** This avoids file-path issues
  under the Next.js bundler and gives versioned upgrades via `PRAGMA user_version`.
- **An `aborted` column was added to `messages`** to mark answers cut off by Stop.
- The first scaffold was deleted and rebuilt from scratch after the design review, so the code
  matches the agreed design from the first commit.

## How it was checked
- `npm run typecheck`: clean.
- `npm test`: 4/4 passing.
- Smoke test against `npm run dev` with a fake API key: the page returns 200, a malformed request
  returns 400, and a valid request sets the `minimi_uid` cookie, creates the conversation, saves the
  user message with its timezone, and streams a readable error from the model.
- Not yet checked: a real model reply (needs `ANTHROPIC_API_KEY`).
