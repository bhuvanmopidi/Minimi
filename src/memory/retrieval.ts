import type Database from "better-sqlite3";
import { claimsForMessages, type StoredClaim } from "./repo";

// Cross-conversation recall (ADR-0011). Three modes, because the brief's examples need all three:
//   topic + date  "Last Tuesday I asked about Postgres"   → keyword match within that day
//   date only     "What did I ask you on 3 November?"     → everything the user asked that day
//   topic only    "the CRM tools we discussed"            → best keyword matches, any date

export type TimeWindow = { label: string; fromUtc: string; toUtc: string };

export type HistoryQuery = {
  userId: string;
  topic: string; // planner-written keywords; may be empty
  windows: TimeWindow[]; // primary readings, tried first
  alternativeWindows: TimeWindow[]; // tried only when the primary readings find nothing
  excludeMessageIds: string[]; // turns already in the model's context
};

/** A past question, the answer that followed, and the facts that answer asserted (if recorded). */
export type Exchange = { askedAt: string; question: string; answer?: string; claims: StoredClaim[] };
export type FoundConversation = { id: string; title: string; exchanges: Exchange[] };

export type HistoryResult =
  | {
      status: "found";
      mode: "topic+date" | "date" | "topic";
      window?: TimeWindow; // the window that matched
      usedAlternative: boolean; // matched on the alternative reading
      otherDate: boolean; // topic found, but not on the date the user named
      conversations: FoundConversation[];
    }
  | { status: "not_found"; mode: "topic+date" | "date" | "topic"; nearest: FoundConversation[] }
  | { status: "skipped" }; // nothing to search for

const MAX_CONVERSATIONS = 3;
const MAX_EXCHANGES = 3;
const ANSWER_EXCERPT_CHARS = 700;
const ALL_TIME: TimeWindow = { label: "any date", fromUtc: "", toUtc: "9999" };

type Hit = { id: string; conversation_id: string; role: "user" | "assistant"; created_at: string };

export function findHistory(db: Database.Database, q: HistoryQuery): HistoryResult {
  const terms = ftsTerms(q.topic);
  const hasTopic = terms.length > 0;
  const hasDate = q.windows.length > 0;
  if (!hasTopic && !hasDate) return { status: "skipped" };

  const mode = hasTopic && hasDate ? "topic+date" : hasDate ? "date" : "topic";
  const search = (w: TimeWindow) => (hasTopic ? topicHits(db, q, terms, w) : dateHits(db, q, w));

  // 1. The dates as the user (most likely) meant them, then the alternative readings.
  //    Topic only: one pass over all time.
  for (const [windows, usedAlternative] of [
    [hasDate ? q.windows : [ALL_TIME], false],
    [q.alternativeWindows, true],
  ] as const) {
    for (const w of windows) {
      const hits = search(w);
      if (hits.length) {
        const window = w === ALL_TIME ? undefined : w;
        return { status: "found", mode, window, usedAlternative, otherDate: false, conversations: group(db, hits) };
      }
    }
  }

  // 2. Topic and date given, but nothing that day: the user may misremember the day.
  if (hasTopic && hasDate) {
    const hits = topicHits(db, q, terms, ALL_TIME);
    if (hits.length) {
      return { status: "found", mode, usedAlternative: false, otherDate: true, conversations: group(db, hits) };
    }
  }

  return { status: "not_found", mode, nearest: hasDate ? nearestTo(db, q, q.windows[0]) : [] };
}

/** Planner keywords → a safe FTS5 query: quoted terms joined by OR (porter stemming matches price/pricing). */
export function ftsTerms(topic: string): string[] {
  const words = topic.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*/gu) ?? [];
  return [...new Set(words.filter((w) => w.length > 1 && !STOPWORDS.has(w)))].slice(0, 8);
}

/**
 * Keyword matches in a time window. How much evidence is required depends on the window:
 * inside a specific day one keyword is enough (the date already narrows it down); across all time,
 * a conversation must match at least two distinct keywords. Otherwise a generic word like "pricing"
 * would "find" any unrelated chat (seen live: a Postgres question matched two CRM chats).
 */
function topicHits(db: Database.Database, q: HistoryQuery, terms: string[], w: TimeWindow): Hit[] {
  const quoted = terms.map((t) => `"${t.replace(/"/g, "")}"`);
  const hits = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.role, m.created_at
       FROM messages_fts f
       JOIN messages m ON m.rowid = f.rowid
       JOIN conversations c ON c.id = m.conversation_id
       WHERE messages_fts MATCH ? AND c.user_id = ?
         AND m.created_at >= ? AND m.created_at < ?
         AND m.id NOT IN (SELECT value FROM json_each(?))
       ORDER BY bm25(messages_fts) LIMIT 30`,
    )
    .all(quoted.join(" OR "), q.userId, w.fromUtc, w.toUtc, JSON.stringify(q.excludeMessageIds)) as Hit[];

  const minTerms = w === ALL_TIME ? Math.min(2, terms.length) : 1;
  if (minTerms <= 1 || !hits.length) return hits;

  // Distinct keywords matched per conversation (across its matched question and answer messages).
  const ids = JSON.stringify(hits.map((h) => h.id));
  const termsPerConversation = new Map<string, number>();
  for (const term of quoted) {
    const matched = db
      .prepare(
        `SELECT DISTINCT m.conversation_id AS c FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
         WHERE messages_fts MATCH ? AND m.id IN (SELECT value FROM json_each(?))`,
      )
      .all(term, ids) as { c: string }[];
    for (const { c } of matched) termsPerConversation.set(c, (termsPerConversation.get(c) ?? 0) + 1);
  }
  return hits.filter((h) => (termsPerConversation.get(h.conversation_id) ?? 0) >= minTerms);
}

function dateHits(db: Database.Database, q: HistoryQuery, w: TimeWindow): Hit[] {
  return db
    .prepare(
      `SELECT m.id, m.conversation_id, m.role, m.created_at
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'
         AND m.created_at >= ? AND m.created_at < ?
         AND m.id NOT IN (SELECT value FROM json_each(?))
       ORDER BY m.created_at LIMIT 30`,
    )
    .all(q.userId, w.fromUtc, w.toUtc, JSON.stringify(q.excludeMessageIds)) as Hit[];
}

/** When nothing matched a date: the user's conversations closest in time, so the agent can offer them. */
function nearestTo(db: Database.Database, q: HistoryQuery, w: TimeWindow): FoundConversation[] {
  const hits = db
    .prepare(
      `SELECT m.id, m.conversation_id, m.role, m.created_at
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = ? AND m.role = 'user'
         AND m.id NOT IN (SELECT value FROM json_each(?))
       ORDER BY ABS(julianday(m.created_at) - julianday(?)) LIMIT 10`,
    )
    .all(q.userId, JSON.stringify(q.excludeMessageIds), w.fromUtc) as Hit[];
  return group(db, hits).slice(0, 2).map((c) => ({ ...c, exchanges: c.exchanges.slice(0, 1) }));
}

/** Matched messages → conversations (best first) → question/answer exchanges around each match. */
function group(db: Database.Database, hits: Hit[]): FoundConversation[] {
  const order: string[] = [];
  const byConversation = new Map<string, Hit[]>();
  for (const h of hits) {
    if (!byConversation.has(h.conversation_id)) {
      byConversation.set(h.conversation_id, []);
      order.push(h.conversation_id);
    }
    byConversation.get(h.conversation_id)!.push(h);
  }

  return order.slice(0, MAX_CONVERSATIONS).map((conversationId) => {
    const messages = db
      .prepare("SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid")
      .all(conversationId) as { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
    const title =
      (db.prepare("SELECT title FROM conversations WHERE id = ?").get(conversationId) as { title: string | null })
        .title ?? truncate(messages.find((m) => m.role === "user")?.content ?? "Untitled", 60);

    // Each match maps to its exchange: the user's question and the answer that followed it.
    const questionIndexes = new Set<number>();
    for (const h of byConversation.get(conversationId)!) {
      const i = messages.findIndex((m) => m.id === h.id);
      if (i < 0) continue;
      const q = messages[i].role === "user" ? i : i - 1;
      if (q >= 0 && messages[q].role === "user") questionIndexes.add(q);
    }

    const picked = [...questionIndexes].sort((a, b) => a - b).slice(0, MAX_EXCHANGES);
    const answerOf = (i: number) => (messages[i + 1]?.role === "assistant" ? messages[i + 1] : undefined);
    const claims = claimsForMessages(db, picked.flatMap((i) => answerOf(i)?.id ?? []));

    const exchanges = picked.map((i) => {
      const answer = answerOf(i);
      return {
        askedAt: messages[i].created_at,
        question: messages[i].content,
        answer: answer ? truncate(answer.content, ANSWER_EXCERPT_CHARS) : undefined,
        claims: answer ? (claims.get(answer.id) ?? []) : [],
      };
    });
    return { id: conversationId, title, exchanges };
  });
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()} …`;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can did do does for from had has have how i if in is it its me my of on or our " +
    "so than that the their them then there these they this to was we were what when where which who why will " +
    "with you your about any asked ask told tell said say since still today now ago last again " +
    // Conversation words that describe the question, not its topic.
    "answer answers answered correct correctly question questions change changed changes true right wrong " +
    "earlier before discussed talked chat conversation conversations remember recall check recheck"
  ).split(" "),
);
