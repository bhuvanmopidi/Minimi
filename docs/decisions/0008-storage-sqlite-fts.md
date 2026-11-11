# 0008: SQLite + FTS5, no vector database

**Status:** Accepted

## Context
We need to store conversations, messages, search snapshots and claims, and find past messages by
topic and date.

## Options
- **Postgres.** ➖ Setup work for every reviewer.
- **Embeddings + a vector store.** ➕ Semantic matching. ➖ Needs a third API key, adds latency, and
  the test cases are mostly about named entities (product names) and dates, where keywords work well.
- **SQLite + FTS5 (chosen).** A single file, created automatically. Real SQL for date-range filters,
  and full-text search with stemming (`porter unicode61`).

## Decision
SQLite via `better-sqlite3`, with an FTS5 index over message content kept in sync by triggers.
The planner writes the history query (e.g. "Postgres hosting pricing"), which makes up for most
of the gap between keyword and semantic search.

Migrations are an append-only list tracked with `PRAGMA user_version`. A shipped migration is
never edited.

## Consequences
- Zero-config for reviewers; the database lives at `./data/minimi.db`.
- If keyword recall proves weak in evals, embeddings can be added later as a second ranking signal
  without changing the schema of existing tables.
