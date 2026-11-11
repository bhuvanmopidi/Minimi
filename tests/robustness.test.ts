import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { renderContext } from "@/agent/context";
import { friendlyError } from "@/agent/errors";
import { sourcesFromParts, toModelMessages } from "@/agent/history";
import { messagesOutsideWindow, updateSummary } from "@/agent/summarize";
import { config } from "@/config";
import { openDatabase } from "@/memory/db";
import { allMessages, getOrCreateConversation, getSummary, insertMessage, prepareRetry, type MessageRow } from "@/memory/repo";

const row = (id: string, role: "user" | "assistant", content: string, partsJson: string | null = null): MessageRow => ({
  id,
  conversation_id: "c",
  role,
  content,
  parts_json: partsJson,
  tz: null,
  aborted: 0,
  created_at: "2026-11-11T10:00:00Z",
});

const toolParts = (results: { n: number; url: string }[]) =>
  JSON.stringify([{ type: "tool-web_search", state: "output-available", output: { results } }]);

describe("toModelMessages", () => {
  it("starts the window at a user message (the API requires it)", () => {
    const out = toModelMessages([row("a0", "assistant", "old answer"), row("q1", "user", "hi")], null);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  it("lists the sources each recent answer actually cited, so follow-ups about them work", () => {
    const parts = toolParts([
      { n: 1, url: "https://neon.com/pricing" },
      { n: 2, url: "https://never-cited.example" },
      { n: 3, url: "https://supabase.com/pricing" },
    ]);
    const out = toModelMessages([row("q", "user", "compare"), row("a", "assistant", "Neon [1], Supabase [3].", parts), row("q2", "user", "what was source 3?")], null);
    expect(out[1].content).toBe(
      "Neon [1], Supabase [3].\n\n(Sources for this answer: [1] https://neon.com/pricing · [3] https://supabase.com/pricing)",
    );
  });

  it("attaches the context block to the latest user message only", () => {
    const out = toModelMessages([row("q", "user", "first"), row("a", "assistant", "ok"), row("q2", "user", "second")], "<context/>");
    expect(out.map((m) => m.content)).toEqual(["first", "ok", "<context/>\n\nsecond"]);
  });

  it("reads sources from searches run before the answer too", () => {
    const parts = JSON.stringify([{ type: "data-search", data: { output: { results: [{ n: 4, url: "https://x.com" }] } } }]);
    expect(sourcesFromParts(parts)).toEqual([{ n: 4, url: "https://x.com" }]);
    expect(sourcesFromParts("not json")).toEqual([]);
  });
});

describe("prepareRetry", () => {
  function setup() {
    const db = openDatabase(":memory:");
    getOrCreateConversation(db, { id: "conv_r", userId: "usr_1", at: "2026-11-11T10:00:00Z" });
    insertMessage(db, { id: "q1", conversationId: "conv_r", role: "user", content: "Neon price?", at: "2026-11-11T10:00:00Z" });
    return db;
  }

  it("reuses the stored question after an error (nothing saved twice)", () => {
    const db = setup();
    expect(prepareRetry(db, "conv_r", "Neon price?")).toBe(true);
    expect(allMessages(db, "conv_r")).toHaveLength(1);
  });

  it("replaces a partial answer saved by Stop", () => {
    const db = setup();
    insertMessage(db, { id: "a1", conversationId: "conv_r", role: "assistant", content: "Neon is…", aborted: true, at: "2026-11-11T10:00:05Z" });
    expect(prepareRetry(db, "conv_r", "Neon price?")).toBe(true);
    expect(allMessages(db, "conv_r").map((m) => m.id)).toEqual(["q1"]);
  });

  it("is a normal send when the conversation doesn't end with that question", () => {
    const db = setup();
    expect(prepareRetry(db, "conv_r", "Something else")).toBe(false);
  });
});

describe("rolling summary", () => {
  function longChat(messages: number) {
    const db = openDatabase(":memory:");
    getOrCreateConversation(db, { id: "conv_long", userId: "usr_1", at: "2026-11-01T00:00:00Z" });
    for (let i = 0; i < messages; i++) {
      const at = new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString();
      insertMessage(db, { id: `m${i}`, conversationId: "conv_long", role: i % 2 ? "assistant" : "user", content: `message ${i}`, at });
    }
    return db;
  }

  it("does nothing while the chat fits in the window", async () => {
    const db = longChat(config.recentTurnLimit);
    expect(await updateSummary(db, "conv_long", async () => "unused")).toBe(false);
  });

  it("summarises what dropped out of the window, then only new messages next time", async () => {
    const db = longChat(30);
    const prompts: string[] = [];
    const fake = async (prompt: string) => {
      prompts.push(prompt);
      return `summary ${prompts.length}`;
    };

    expect(await updateSummary(db, "conv_long", fake)).toBe(true);
    const outside = messagesOutsideWindow(allMessages(db, "conv_long"), config.recentTurnLimit);
    expect(getSummary(db, "conv_long")).toEqual({ summary: "summary 1", through: outside[outside.length - 1].created_at });
    expect(prompts[0]).toContain("message 0");

    // Two more messages: only the newly dropped ones are folded into the existing summary.
    insertMessage(db, { id: "m30", conversationId: "conv_long", role: "user", content: "message 30", at: "2026-11-01T01:00:00Z" });
    insertMessage(db, { id: "m31", conversationId: "conv_long", role: "assistant", content: "message 31", at: "2026-11-01T01:01:00Z" });
    expect(await updateSummary(db, "conv_long", fake)).toBe(true);
    expect(prompts[1]).toContain("Summary so far:\nsummary 1");
    expect(prompts[1]).not.toContain("message 0\n");

    expect(await updateSummary(db, "conv_long", fake)).toBe(false); // nothing new
  });

  it("the summary leaves no gap before the next turn's window", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`m${i}`, i % 2 ? "assistant" : "user", `${i}`));
    const outside = messagesOutsideWindow(rows, 12);
    // Next turn adds one message; its 12-message window starts at index 31 - 12 = 19 ≤ outside.length.
    expect(outside.length).toBeGreaterThanOrEqual(31 - 12);
  });
});

describe("friendlyError", () => {
  const apiError = (statusCode: number) =>
    new APICallError({ message: "x", url: "https://api.anthropic.com", requestBodyValues: {}, statusCode });

  it.each([
    [429, "rate-limited"],
    [529, "overloaded"],
    [401, "API key was rejected"],
    [500, "temporary server error"],
  ])("HTTP %i → a clear message", (status, text) => {
    expect(friendlyError(apiError(status))).toContain(text);
  });

  it("looks inside retry errors", () => {
    const err = new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [apiError(529)] });
    expect(friendlyError(err)).toContain("overloaded");
  });

  it("never leaks internals", () => {
    expect(friendlyError(new Error("ECONNRESET at socket 0x1f"))).toBe(
      "Something went wrong while generating the answer. Press Retry.",
    );
  });
});

describe("context budget", () => {
  it("keeps the best-ranked sources and drops the rest beyond the budget", () => {
    const sources = Array.from({ length: 40 }, (_, i) => ({
      n: i + 1,
      title: `T${i + 1}`,
      url: `https://s${i}.com`,
      domain: `s${i}.com`,
      snippet: "x".repeat(700),
    }));
    const out = renderContext({
      nowLabel: "now",
      dates: { resolved: [], unresolved: [] },
      history: null,
      historyFromFallback: false,
      search: { sources, errors: [], fetchedAt: "2026-11-11T10:00:00Z" },
      timeZone: "UTC",
    });
    expect(out).toContain("[1] T1");
    expect(out).not.toContain("[40] T40");
    expect(out.length).toBeLessThan(16_000);
  });
});
