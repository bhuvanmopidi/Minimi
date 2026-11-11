import { describe, expect, it } from "vitest";
import { openDatabase } from "@/memory/db";
import { getOrCreateConversation, insertMessage, recentMessages } from "@/memory/repo";

const T = (day: number, hour = 10) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();

describe("database", () => {
  it("runs migrations once and records the schema version", () => {
    const db = openDatabase(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(1);
  });

  it("indexes messages for full-text search", () => {
    const db = openDatabase(":memory:");
    getOrCreateConversation(db, { id: "conv_a", userId: "usr_1", at: T(3) });
    insertMessage(db, { id: "m1", conversationId: "conv_a", role: "user", content: "Compare Neon and Supabase Postgres hosting", at: T(3) });

    const hit = db
      .prepare("SELECT m.id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH ?")
      .get("postgres");
    expect(hit).toEqual({ id: "m1" });
  });
});

describe("conversations", () => {
  it("refuses a conversation id that belongs to another user", () => {
    const db = openDatabase(":memory:");
    expect(getOrCreateConversation(db, { id: "conv_a", userId: "usr_1", at: T(3) })).not.toBeNull();
    expect(getOrCreateConversation(db, { id: "conv_a", userId: "usr_2", at: T(3) })).toBeNull();
  });

  it("returns the most recent messages, oldest first", () => {
    const db = openDatabase(":memory:");
    getOrCreateConversation(db, { id: "conv_a", userId: "usr_1", at: T(3) });
    for (let i = 1; i <= 5; i++) {
      insertMessage(db, { id: `m${i}`, conversationId: "conv_a", role: i % 2 ? "user" : "assistant", content: `turn ${i}`, at: T(3, i) });
    }
    expect(recentMessages(db, "conv_a", 3).map((m) => m.id)).toEqual(["m3", "m4", "m5"]);
  });
});
