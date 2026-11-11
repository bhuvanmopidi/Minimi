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
