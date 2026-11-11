import { describe, expect, it } from "vitest";
import { extractClaims, type GenerateClaims } from "@/agent/claims";
import { renderContext } from "@/agent/context";
import type { Plan } from "@/agent/planner";
import { buildPrefetch } from "@/agent/searchPlan";
import { openDatabase } from "@/memory/db";
import { seedDemoHistory } from "@/memory/demo";
import { getOrCreateConversation, insertClaims, insertMessage, setTitleIfMissing } from "@/memory/repo";
import { findHistory, type HistoryResult } from "@/memory/retrieval";
import type { Source } from "@/tools/webSearch";

const sources: Source[] = [
  { n: 1, title: "Neon pricing", url: "https://neon.com/pricing", domain: "neon.com", published: "2026-11-06", snippet: "…" },
  { n: 2, title: "Supabase pricing", url: "https://supabase.com/pricing", domain: "supabase.com", snippet: "…" },
];

describe("extractClaims", () => {
  it("maps citation numbers to source URLs and dates, and drops empty rows", async () => {
    const generate: GenerateClaims = async () => ({
      claims: [
        { entity: "Neon", attribute: "Launch plan price", value: "$0.106/CU-hour", source: 1 },
        { entity: "Supabase", attribute: "Pro plan price", value: "$25/month", source: 2 },
        { entity: "Railway", attribute: "Hobby plan", value: "$5/month", source: 9 }, // unknown source → no URL
        { entity: " ", attribute: "x", value: "y" }, // empty entity → dropped
      ],
    });
    expect(await extractClaims("answer text", sources, generate)).toEqual([
      { entity: "Neon", attribute: "Launch plan price", value: "$0.106/CU-hour", sourceUrl: "https://neon.com/pricing", sourceDate: "2026-11-06" },
      { entity: "Supabase", attribute: "Pro plan price", value: "$25/month", sourceUrl: "https://supabase.com/pricing", sourceDate: null },
      { entity: "Railway", attribute: "Hobby plan", value: "$5/month", sourceUrl: null, sourceDate: null },
    ]);
  });

  it("skips answers with no web sources: the ledger only stores facts backed by evidence", async () => {
    let called = false;
    const generate: GenerateClaims = async () => {
      called = true;
      return { claims: [] };
    };
    expect(await extractClaims("Canberra is the capital.", [], generate)).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("claims in history", () => {
  it("history search returns the facts recorded for each past answer", () => {
    const db = openDatabase(":memory:");
    seedDemoHistory(db, { userId: "usr_aaaabbbbccccdddd", timeZone: "UTC", now: new Date("2026-11-11T10:00:00Z") });
    const r = findHistory(db, {
      userId: "usr_aaaabbbbccccdddd",
      topic: "postgres hosting",
      windows: [],
      alternativeWindows: [],
      excludeMessageIds: [],
    });
    expect(r.status).toBe("found");
    if (r.status !== "found") return;
    expect(r.conversations[0].exchanges[0].claims.map((c) => `${c.entity}: ${c.value}`)).toEqual([
      "Neon: $19/month",
      "Supabase: $25/month per project",
      "Railway: $5/month, then usage-based",
    ]);
  });

  it("old answers without recorded facts still work (empty claims)", () => {
    const db = openDatabase(":memory:");
    getOrCreateConversation(db, { id: "conv_x", userId: "usr_1", at: "2026-11-01T10:00:00Z" });
    insertMessage(db, { id: "q", conversationId: "conv_x", role: "user", content: "neon pricing?", at: "2026-11-01T10:00:00Z" });
    insertMessage(db, { id: "a", conversationId: "conv_x", role: "assistant", content: "Neon is…", at: "2026-11-01T10:00:01Z" });
    const r = findHistory(db, { userId: "usr_1", topic: "neon", windows: [], alternativeWindows: [], excludeMessageIds: [] });
    expect(r.status === "found" && r.conversations[0].exchanges[0].claims).toEqual([]);
  });
});

describe("buildPrefetch", () => {
  const plan = (over: Partial<Plan>): Plan => ({
    intent: "new_question",
    needsHistory: false,
    historyQuery: "",
    searches: [],
    dates: null,
    ...over,
  });
  const claim = (entity: string, attribute: string) => ({
    entity,
    attribute,
    value: "v",
    messageId: "m",
    assertedAt: "2026-11-09T10:00:00Z",
  });
  const found = (claims: ReturnType<typeof claim>[]): HistoryResult => ({
    status: "found",
    mode: "topic+date",
    usedAlternative: false,
    otherDate: false,
    conversations: [{ id: "c", title: "t", exchanges: [{ askedAt: "", question: "q", claims }] }],
  });

  it("uses the planner's searches as-is", () => {
    expect(buildPrefetch(plan({ searches: [{ query: "latest iphone price", topic: "general" }] }), null)).toEqual([
      { queries: ["latest iphone price"], since: undefined, topic: "general" },
    ]);
  });

  it("on a re-check, adds one current-state search per recorded fact, after the planner's news search", () => {
    const batches = buildPrefetch(
      plan({ intent: "recheck", searches: [{ query: "CRM launches", since: "2026-11-09", topic: "news" }] }),
      found([claim("HubSpot", "Professional price"), claim("Attio", "Pro price"), claim("hubspot", "professional PRICE")]),
    );
    expect(batches).toEqual([
      { queries: ["CRM launches"], since: "2026-11-09", topic: "news" },
      { queries: ["HubSpot Professional price", "Attio Pro price"], since: undefined, topic: "general" },
    ]);
  });

  it("splits into batches of 4 and caps the total at 8 queries", () => {
    const many = Array.from({ length: 12 }, (_, i) => claim(`Tool${i}`, "price"));
    const batches = buildPrefetch(plan({ intent: "recheck" }), found(many));
    expect(batches.map((b) => b.queries.length)).toEqual([4, 4]);
  });

  it("does not add fact searches when it isn't a re-check", () => {
    expect(buildPrefetch(plan({ intent: "recall" }), found([claim("Neon", "price")]))).toEqual([]);
  });
});

describe("context with facts and prefetched results", () => {
  it("lists the facts said then and the numbered search results", () => {
    const out = renderContext({
      intent: "recheck",
      dates: { resolved: [], unresolved: [] },
      history: {
        status: "found",
        mode: "topic",
        usedAlternative: false,
        otherDate: false,
        conversations: [
          {
            id: "c",
            title: "Postgres",
            exchanges: [
              {
                askedAt: "2026-11-03T06:10:00Z",
                question: "Compare…",
                claims: [{ entity: "Neon", attribute: "Launch plan price", value: "$19/month", sourceUrl: "https://www.neon.tech/pricing", sourceDate: "2026-11-01", messageId: "m", assertedAt: "" }],
              },
            ],
          },
        ],
      },
      historyFromFallback: false,
      search: { sources, errors: [], fetchedAt: "2026-11-11T10:00:00Z" },
      timeZone: "UTC",
    })!;
    expect(out).toContain("<intent>recheck");
    expect(out).toContain("- Neon | Launch plan price | $19/month | source neon.tech, 2026-11-01");
    expect(out).toContain("[1] Neon pricing (neon.com, published 2026-11-06)");
    expect(out).toContain("[2] Supabase pricing (supabase.com)");
  });
});

describe("titles", () => {
  it("are set once, from the first turn, and never overwritten", () => {
    const db = openDatabase(":memory:");
    getOrCreateConversation(db, { id: "conv_t", userId: "usr_1", at: "2026-11-11T10:00:00Z" });
    setTitleIfMissing(db, "conv_t", "Postgres pricing");
    setTitleIfMissing(db, "conv_t", "Something else");
    expect(db.prepare("SELECT title FROM conversations WHERE id = 'conv_t'").get()).toEqual({ title: "Postgres pricing" });
  });

  it("claims can be stored for an answer and survive a reload", () => {
    const db = openDatabase(":memory:");
    getOrCreateConversation(db, { id: "conv_c", userId: "usr_1", at: "2026-11-11T10:00:00Z" });
    insertMessage(db, { id: "a1", conversationId: "conv_c", role: "assistant", content: "…", at: "2026-11-11T10:00:00Z" });
    insertClaims(db, "a1", [{ entity: "Neon", attribute: "price", value: "$15" }], "2026-11-11T10:00:00Z");
    expect(db.prepare("SELECT entity, value FROM claims").all()).toEqual([{ entity: "Neon", value: "$15" }]);
  });
});
