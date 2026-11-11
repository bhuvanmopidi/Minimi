# 0009: Anonymous per-browser identity

**Status:** Accepted

## Context
Memory across sessions needs to know whose history is whose. The challenge doesn't ask for accounts.

## Options
- **Real auth (OAuth, email).** ➖ Friction for reviewers, out of scope.
- **No identity at all.** ➖ Everyone shares one history.
- **Anonymous cookie (chosen).**

## Decision
On the first request the server sets an `httpOnly` cookie `minimi_uid` (one year). Every
conversation row stores its `user_id`. A request for a conversation id owned by another user is
rejected, so one browser can never read or append to another's chat.

## Consequences
- History is per browser. Clearing cookies starts a fresh history.
- Real auth can replace the cookie later without changing the data model.
