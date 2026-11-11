# 0007: The server owns conversation history

**Status:** Accepted

## Context
By default the AI SDK's `useChat` sends the whole conversation with every request.

## Options
- **Client sends everything** (SDK default). ➖ Requests grow with the chat. ➖ The client can send a
  tampered history. ➖ The server still needs its own copy for cross-conversation memory.
- **Client sends only the new message (chosen).** The server loads history from SQLite.

## Decision
Request body: `{ conversationId, message: { text }, timeZone, locale }`. The server saves the user
message **before** model work, loads the recent turns, and saves the answer (with `parts_json`)
when the stream ends. The stream is consumed to the end even if the tab closes, so the answer is
always saved. A Stop press marks it `aborted`.

## Consequences
- Small requests, a single source of truth, and reopened chats render exactly as they were.
- Server-side history loading moved from Phase 2 into Phase 0, because the request shape depends on it.
