import { describe, expect, it, vi } from "vitest";
import { renderContext } from "@/agent/context";
import { planTurn, renderPlannerPrompt, type GeneratePlan, type PlanInput } from "@/agent/planner";
import { openDatabase } from "@/memory/db";
import { demoChats, seedDemoHistory } from "@/memory/demo";
import { listConversations } from "@/memory/repo";
import { buildCalendar } from "@/time/calendar";
import { findDateMentions } from "@/time/candidates";
import { formatDay } from "@/time/zone";

const NOW = "Wednesday 11 November 2026, 15:30 (Asia/Kolkata)";
const today = "2026-11-11";
const input = (message: string): PlanInput => ({
  message,
  recentTurns: [],
  nowLabel: "Wednesday, 11 November 2026, 15:30 (Asia/Kolkata)",
  locale: "en-IN",
  monthFirst: false,
  calendar: buildCalendar(today),
  mentions: findDateMentions(message, { today, locale: "en-IN" }),
});

describe("planTurn", () => {
  it("keeps well-formed decisions and drops malformed ones", async () => {
    const generate: GeneratePlan = async () => ({
      intent: "recheck",
      needsHistory: true,
      historyQuery: "  postgres hosting  ",
      searches: [
        { query: "postgres hosting price changes", since: "2026-11-03", topic: "news" },
        { query: "x" }, // too short → dropped
        { query: "neon pricing", since: "3 Nov" }, // invalid since → dropped, query kept
      ],
      title: '"Postgres pricing re-check"',
      dates: [
        { choice: "candidate", mention: 0, reading: 1, confidence: "medium" },
        { choice: "candidate" }, // missing indexes → dropped
        { choice: "own", text: "the day we did CRMs", start: "2026-11-09", weekday: "Monday" },
        { choice: "own", text: "no start" }, // missing start → dropped
      ],
    });
    const { plan, source } = await planTurn(input("Last Tuesday I asked about Postgres"), generate);
    expect(source).toBe("planner");
    expect(plan.intent).toBe("recheck");
    expect(plan.historyQuery).toBe("postgres hosting");
    expect(plan.title).toBe("Postgres pricing re-check");
    expect(plan.searches).toEqual([
      { query: "postgres hosting price changes", since: "2026-11-03", topic: "news" },
      { query: "neon pricing", since: undefined, topic: "general" },
    ]);
    expect(plan.dates).toEqual([
      { choice: "candidate", mention: 0, reading: 1, confidence: "medium" },
      { choice: "own", text: "the day we did CRMs", start: "2026-11-09", end: undefined, weekday: "Monday", confidence: "medium" },
    ]);
  });

  it("falls back to searching with the user's words and chrono's dates when the planner fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { plan, source } = await planTurn(input("What did I ask on 3 November?"), async () => {
      throw new Error("timeout");
    });
    expect(source).toBe("fallback");
    expect(plan).toEqual({
      intent: "new_question",
      needsHistory: true,
      historyQuery: "What did I ask on 3 November?",
      searches: [], // left to the main model's web_search tool
      dates: null,
    });
  });

  it("gives the planner the calendar, locale and numbered readings", () => {
    const prompt = renderPlannerPrompt(input("Last Tuesday I asked about Postgres"));
    expect(prompt).toContain("writes numeric dates day-first");
    expect(prompt).toContain('0: "Last Tuesday" → reading 0: Tuesday 10 November 2026 | reading 1: Tuesday 3 November 2026');
    expect(prompt).toContain("Wed 11 Nov 2026-11-11 (today)");
  });
});

describe("renderContext", () => {
  const dates = {
    resolved: [
      {
        text: "Last Tuesday",
        primary: { start: "2026-11-10", end: "2026-11-10", label: "Tuesday 10 November 2026" },
        alternative: { start: "2026-11-03", end: "2026-11-03", label: "Tuesday 3 November 2026" },
        source: "chrono" as const,
      },
    ],
    unresolved: [],
  };

  it("always carries the current date and time, even when there is nothing else", () => {
    expect(renderContext({ nowLabel: NOW, dates: { resolved: [], unresolved: [] }, history: null, historyFromFallback: false, timeZone: "UTC" })).toBe(`<context>
<now>${NOW}</now>
</context>`);
  });

  it("states the resolved dates and an explicit not_found, so the model can't invent history", () => {
    const out = renderContext({
      nowLabel: NOW,
      dates,
      history: { status: "not_found", mode: "date", nearest: [] },
      historyFromFallback: false,
      timeZone: "Asia/Kolkata",
    })!;
    expect(out).toContain('"Last Tuesday" → Tuesday 10 November 2026 (or possibly Tuesday 3 November 2026)');
    expect(out).toContain('<history status="not_found">');
  });

  it("shows found exchanges in the user's timezone and notes an alternative-date match", () => {
    const out = renderContext({
      nowLabel: NOW,
      dates,
      history: {
        status: "found",
        mode: "topic+date",
        window: { label: "Tuesday 3 November 2026", fromUtc: "", toUtc: "" },
        usedAlternative: true,
        otherDate: false,
        conversations: [
          {
            id: "c1",
            title: "Postgres hosting",
            exchanges: [{ askedAt: "2026-11-03T06:10:00.000Z", question: "Compare Neon…", answer: "Neon is $19…", claims: [] }],
          },
        ],
      },
      historyFromFallback: false,
      timeZone: "Asia/Kolkata",
    })!;
    expect(out).toContain("matched Tuesday 3 November 2026");
    expect(out).toContain('at="Tuesday 3 November 2026, 11:40"');
    expect(out).toContain("<you_answered>Neon is $19…</you_answered>");
  });
});

describe("demo history", () => {
  it("lines up with the challenge's examples: Monday = CRM, the Tuesday before last week = Postgres", () => {
    const [crm, pg] = demoChats(today);
    expect(formatDay(crm.day)).toBe("Monday 9 November 2026");
    expect(formatDay(pg.day)).toBe("Tuesday 3 November 2026");
  });

  it("is labelled, belongs only to the requesting user, and reloading replaces it", () => {
    const db = openDatabase(":memory:");
    const opts = { userId: "usr_aaaabbbbccccdddd", timeZone: "Asia/Kolkata", now: new Date("2026-11-11T10:00:00Z") };
    seedDemoHistory(db, opts);
    seedDemoHistory(db, opts);
    const list = listConversations(db, opts.userId);
    expect(list).toHaveLength(3);
    expect(list.every((c) => c.title.startsWith("Demo ·"))).toBe(true);
    expect(listConversations(db, "usr_someoneelse0000")).toEqual([]);
  });
});
