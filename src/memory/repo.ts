import type Database from "better-sqlite3";

// Thin, typed SQL layer. Every function takes the db explicitly so tests can use :memory:.

export type Role = "user" | "assistant";

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  parts_json: string | null;
  tz: string | null;
  aborted: 0 | 1;
  created_at: string;
};

/**
 * Returns the conversation, creating it on first use. Returns null when the id
 * belongs to another user, so one browser can never read or append to another's chat.
 */
export function getOrCreateConversation(
  db: Database.Database,
  args: { id: string; userId: string; at: string },
): { id: string; user_id: string; title: string | null } | null {
  db.prepare(
    `INSERT INTO conversations (id, user_id, created_at, updated_at)
     VALUES (@id, @userId, @at, @at) ON CONFLICT(id) DO NOTHING`,
  ).run(args);
  const row = db
    .prepare("SELECT id, user_id, title FROM conversations WHERE id = ?")
    .get(args.id) as { id: string; user_id: string; title: string | null };
  return row.user_id === args.userId ? row : null;
}

export function insertMessage(
  db: Database.Database,
  msg: {
    id: string;
    conversationId: string;
    role: Role;
    content: string;
    partsJson?: string | null;
    tz?: string | null;
    aborted?: boolean;
    at: string;
  },
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, parts_json, tz, aborted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.conversationId,
      msg.role,
      msg.content,
      msg.partsJson ?? null,
      msg.tz ?? null,
      msg.aborted ? 1 : 0,
      msg.at,
    );
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(msg.at, msg.conversationId);
  })();
}

/** Raw snapshots of the web searches behind one assistant message. */
export function insertSearches(
  db: Database.Database,
  messageId: string,
  searches: { id: string; query: string; since?: string; resultsJson: string; fetchedAt: string }[],
): void {
  const stmt = db.prepare(
    "INSERT INTO searches (id, message_id, query, since, results_json, fetched_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const s of searches) stmt.run(s.id, messageId, s.query, s.since ?? null, s.resultsJson, s.fetchedAt);
  })();
}

/** A checkable fact an answer asserted (the claims ledger, ADR-0006). */
export type Claim = {
  entity: string;
  attribute: string;
  value: string;
  sourceUrl?: string | null;
  sourceDate?: string | null;
};

export type StoredClaim = Claim & { messageId: string; assertedAt: string };

export function insertClaims(db: Database.Database, messageId: string, claims: Claim[], assertedAt: string): void {
  const stmt = db.prepare(
    `INSERT INTO claims (id, message_id, entity, attribute, value, source_url, source_date, asserted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    claims.forEach((c, i) =>
      stmt.run(`${messageId}_c${i}`, messageId, c.entity, c.attribute, c.value, c.sourceUrl ?? null, c.sourceDate ?? null, assertedAt),
    );
  })();
}

/** Claims for the given answers, keyed by message id. */
export function claimsForMessages(db: Database.Database, messageIds: string[]): Map<string, StoredClaim[]> {
  const rows = db
    .prepare(
      `SELECT message_id AS messageId, entity, attribute, value, source_url AS sourceUrl,
              source_date AS sourceDate, asserted_at AS assertedAt
       FROM claims WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
    )
    .all(JSON.stringify(messageIds)) as StoredClaim[];
  const byMessage = new Map<string, StoredClaim[]>();
  for (const r of rows) byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r]);
  return byMessage;
}

export function setTitleIfMissing(db: Database.Database, conversationId: string, title: string): void {
  db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND title IS NULL").run(title, conversationId);
}

export type ConversationSummary = { id: string; title: string; updatedAt: string };

/** The user's conversations for the sidebar, most recent first. Untitled ones use their first question. */
export function listConversations(db: Database.Database, userId: string, limit = 50): ConversationSummary[] {
  return db
    .prepare(
      `SELECT c.id, c.updated_at AS updatedAt,
              COALESCE(c.title, (SELECT substr(m.content, 1, 80) FROM messages m
                                 WHERE m.conversation_id = c.id AND m.role = 'user'
                                 ORDER BY m.created_at, m.rowid LIMIT 1), 'New chat') AS title
       FROM conversations c
       WHERE c.user_id = ? AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
       ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .all(userId, limit) as ConversationSummary[];
}

/** All messages of a conversation, oldest first, or null if it isn't this user's. */
export function conversationMessages(db: Database.Database, conversationId: string, userId: string): MessageRow[] | null {
  const owner = db.prepare("SELECT user_id FROM conversations WHERE id = ?").get(conversationId) as
    | { user_id: string }
    | undefined;
  if (!owner || owner.user_id !== userId) return null;
  return db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid")
    .all(conversationId) as MessageRow[];
}

/** The last `limit` messages of a conversation, oldest first (the order the model reads them). */
export function recentMessages(db: Database.Database, conversationId: string, limit: number): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE conversation_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(conversationId, limit) as MessageRow[];
  return rows.reverse();
}
