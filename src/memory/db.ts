import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "@/config";

// Ordered, append-only migrations. Never edit a shipped entry; add a new one.
const migrations: string[] = [
  `
  CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT,
    summary     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX conversations_user ON conversations(user_id, updated_at);

  -- Times are UTC ISO strings; tz records the user's timezone so "3 November" can be
  -- matched against the user's local day, not the server's.
  CREATE TABLE messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content          TEXT NOT NULL,
    parts_json       TEXT,
    tz               TEXT,
    aborted          INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
  );
  CREATE INDEX messages_conversation ON messages(conversation_id, created_at);

  -- Full-text index over message content for cross-conversation recall.
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content, content='messages', content_rowid='rowid', tokenize='porter unicode61'
  );
  CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  END;

  -- Raw search snapshots: what the web said, and when we looked.
  CREATE TABLE searches (
    id           TEXT PRIMARY KEY,
    message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
    query        TEXT NOT NULL,
    since        TEXT,
    results_json TEXT NOT NULL,
    fetched_at   TEXT NOT NULL
  );

  -- Claims ledger: structured facts the assistant asserted, so later turns can diff them.
  CREATE TABLE claims (
    id           TEXT PRIMARY KEY,
    message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    entity       TEXT NOT NULL,
    attribute    TEXT NOT NULL,
    value        TEXT NOT NULL,
    source_url   TEXT,
    source_date  TEXT,
    asserted_at  TEXT NOT NULL
  );
  CREATE INDEX claims_message ON claims(message_id);

  CREATE TABLE search_cache (
    key          TEXT PRIMARY KEY,
    results_json TEXT NOT NULL,
    expires_at   TEXT NOT NULL
  );
  `,
  // 2 (Phase 4): rolling summary of long conversations covers messages up to this timestamp.
  `
  ALTER TABLE conversations ADD COLUMN summary_through TEXT;
  `,
];

function migrate(db: Database.Database) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < migrations.length; version++) {
    db.transaction(() => {
      db.exec(migrations[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export function openDatabase(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

// Reuse one connection across Next.js hot reloads in dev.
const globalForDb = globalThis as unknown as { minimiDb?: Database.Database };

export function getDb(): Database.Database {
  globalForDb.minimiDb ??= openDatabase(config.databasePath);
  return globalForDb.minimiDb;
}
