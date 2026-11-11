import { describe, expect, it } from "vitest";
import { openDatabase } from "@/memory/db";
import { getOrCreateConversation, insertMessage } from "@/memory/repo";
import { findHistory, ftsTerms, type HistoryQuery, type TimeWindow } from "@/memory/retrieval";
import { toUtcRange } from "@/time/validate";

const TZ = "Asia/Kolkata";
const day = (d: string): TimeWindow => ({ label: d, ...toUtcRange({ start: d, end: d, label: d }, TZ) });

// Local times in India → stored as UTC, like the app does.
const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+05:30`).toISOString();

function seed() {
  const db = openDatabase(":memory:");
  const chat = (id: string, user: string, when: string, turns: [string, string][]) => {
    getOrCreateConversation(db, { id, userId: user, at: when });
    turns.forEach(([q, a], i) => {
      insertMessage(db, { id: `${id}_q${i}`, conversationId: id, role: "user", content: q, at: when });
      insertMessage(db, { id: `${id}_a${i}`, conversationId: id, role: "assistant", content: a, at: when });
    });
  };
  chat("conv_pg", "usr_me", at("2026-11-03", "11:40"), [
    ["Compare Postgres hosting for a small SaaS: Neon, Supabase, Railway", "Neon's Launch plan is $19/mo…"],
  ]);
  chat("conv_crm", "usr_me", at("2026-11-09", "10:00"), [
    ["Shortlist 5 CRM tools for a 20-person sales team", "HubSpot, Pipedrive, Salesforce, Zoho, Attio…"],
  ]);
  chat("conv_other_user", "usr_other", at("2026-11-03", "09:00"), [
    ["Postgres hosting options?", "Someone else's answer"],
  ]);
  return db;
}

const base = (over: Partial<HistoryQuery>): HistoryQuery => ({
  userId: "usr_me",
  topic: "",
  windows: [],
  alternativeWindows: [],
  excludeMessageIds: [],
  ...over,
});

describe("findHistory", () => {
  it("topic + date: finds the matching exchange on that day", () => {
    const r = findHistory(seed(), base({ topic: "postgres hosting pricing", windows: [day("2026-11-03")] }));
    expect(r).toMatchObject({ status: "found", mode: "topic+date", usedAlternative: false, otherDate: false });
    if (r.status !== "found") return;
    expect(r.conversations.map((c) => c.id)).toEqual(["conv_pg"]);
    expect(r.conversations[0].exchanges[0]).toMatchObject({
      question: expect.stringContaining("Postgres hosting"),
      answer: expect.stringContaining("$19/mo"),
    });
  });

  it('topic + date: "last Tuesday" falls back to the alternative reading', () => {
    const r = findHistory(
      seed(),
      base({ topic: "postgres", windows: [day("2026-11-10")], alternativeWindows: [day("2026-11-03")] }),
    );
    expect(r).toMatchObject({ status: "found", usedAlternative: true, window: { label: "2026-11-03" } });
  });

  it("topic + date: the topic on a different day is reported as otherDate", () => {
    const r = findHistory(seed(), base({ topic: "CRM tools", windows: [day("2026-11-10")] }));
    expect(r).toMatchObject({ status: "found", otherDate: true });
  });

  it("date only: everything the user asked that day", () => {
    const r = findHistory(seed(), base({ windows: [day("2026-11-09")] }));
    expect(r).toMatchObject({ status: "found", mode: "date" });
    if (r.status === "found") expect(r.conversations[0].exchanges[0].question).toContain("CRM");
  });

  it("topic only: best match, any date", () => {
    const r = findHistory(seed(), base({ topic: "sales team crm shortlist" }));
    expect(r).toMatchObject({ status: "found", mode: "topic" });
    if (r.status === "found") expect(r.conversations[0].id).toBe("conv_crm");
  });

  it("not found on a date: reports the nearest conversations instead", () => {
    const r = findHistory(seed(), base({ windows: [day("2026-11-05")] }));
    expect(r.status).toBe("not_found");
    if (r.status === "not_found") expect(r.nearest.length).toBeGreaterThan(0);
  });

  it("never returns another user's conversations", () => {
    const r = findHistory(seed(), base({ userId: "usr_nobody", topic: "postgres", windows: [day("2026-11-03")] }));
    expect(r).toMatchObject({ status: "not_found", nearest: [] });
    const mine = findHistory(seed(), base({ topic: "postgres" }));
    if (mine.status === "found") expect(mine.conversations.map((c) => c.id)).not.toContain("conv_other_user");
  });

  it("excludes turns already in the model's context", () => {
    const r = findHistory(seed(), base({ topic: "postgres", excludeMessageIds: ["conv_pg_q0", "conv_pg_a0"] }));
    expect(r.status).toBe("not_found");
  });

  it("is skipped when there's neither a topic nor a date", () => {
    expect(findHistory(seed(), base({ topic: "what did I ask" }))).toEqual({ status: "skipped" });
  });
});

describe("ftsTerms", () => {
  it("keeps meaningful words and drops filler", () => {
    expect(ftsTerms("What did I ask about Postgres hosting pricing?")).toEqual(["postgres", "hosting", "pricing"]);
  });

  it('neutralises FTS syntax characters like quotes and "*"', () => {
    expect(ftsTerms('neon" OR * NEAR(')).toEqual(["neon", "near"]);
  });
});
