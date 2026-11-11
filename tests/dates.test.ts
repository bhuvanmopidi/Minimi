import { describe, expect, it } from "vitest";
import { buildCalendar } from "@/time/calendar";
import { findDateMentions } from "@/time/candidates";
import { resolveDates, toUtcRange, type PlannerDate } from "@/time/validate";
import { dayIn, dayStartUtc } from "@/time/zone";

// Reference: Wednesday 11 November 2026 (as in the challenge examples).
const today = "2026-11-11";
const IN = { today, locale: "en-IN" };
const US = { today, locale: "en-US" };

const starts = (text: string, opts = IN) => findDateMentions(text, opts).map((m) => m.readings.map((r) => r.start));

describe("findDateMentions: weekdays", () => {
  it('"Monday" is the most recent past Monday', () => {
    expect(starts("On Monday we shortlisted 5 CRM tools")).toEqual([["2026-11-09"]]);
  });

  it('"last Tuesday" keeps both readings: yesterday first, then the week before', () => {
    expect(starts("Last Tuesday I asked you about Postgres hosting")).toEqual([["2026-11-10", "2026-11-03"]]);
  });

  it('"this Tuesday" looking back is the past one, not next week', () => {
    expect(starts("this Tuesday")).toEqual([["2026-11-10"]]);
  });
});

describe("findDateMentions: explicit dates", () => {
  it('"3 November" without a year is this year when in the past', () => {
    expect(starts("What did I ask you on 3 November?")).toEqual([["2026-11-03"]]);
  });

  it('"25 December" without a year is the most recent one (last year)', () => {
    expect(starts("what did we say on 25 December")).toEqual([["2025-12-25"]]);
  });

  it("ISO dates are unambiguous", () => {
    expect(starts("on 2026-10-03")).toEqual([["2026-10-03"]]);
  });

  it("yesterday and N days ago", () => {
    expect(starts("yesterday")).toEqual([["2026-11-10"]]);
    expect(starts("2 days ago")).toEqual([["2026-11-09"]]);
  });
});

describe("findDateMentions: numeric dates and locale", () => {
  it('"3-10-26" is day-first in India, with month-first as the alternative', () => {
    expect(starts("back in 3-10-26", IN)).toEqual([["2026-10-03", "2026-03-10"]]);
  });

  it('"3-10-26" is month-first in the US, with day-first as the alternative', () => {
    expect(starts("back in 3-10-26", US)).toEqual([["2026-03-10", "2026-10-03"]]);
  });

  it('"13-10-26" has only one valid reading', () => {
    expect(starts("on 13-10-26", IN)).toEqual([["2026-10-13"]]);
  });

  it("other separators work too", () => {
    expect(starts("on 3/10/26", IN)[0][0]).toBe("2026-10-03");
    expect(starts("on 3.10.26", IN)[0][0]).toBe("2026-10-03");
  });

  it("a reading in the future is dropped when another reading is in the past", () => {
    // 10-12-26: day-first = 10 Dec 2026 (future), month-first = 12 Oct 2026 (past).
    expect(starts("on 10-12-26", IN)).toEqual([["2026-10-12"]]);
  });
});

describe("findDateMentions: ranges", () => {
  it('"last week" is the whole previous Monday–Sunday week', () => {
    const [m] = findDateMentions("what did I ask last week", IN);
    expect(m.readings[0]).toMatchObject({ start: "2026-11-02", end: "2026-11-08" });
  });

  it('"last month" is the whole month', () => {
    const [m] = findDateMentions("last month", IN);
    expect(m.readings[0]).toMatchObject({ start: "2026-10-01", end: "2026-10-31", label: "October 2026" });
  });

  it('"this month" is clipped at today', () => {
    const [m] = findDateMentions("in November", IN);
    expect(m.readings[0]).toMatchObject({ start: "2026-11-01", end: "2026-11-11" });
  });
});

describe("findDateMentions: things that are not dates", () => {
  it.each(["Postgres 16 vs 17", "May I ask something?", "Python 3.10 release", "meet at 4 pm"])("%s", (text) => {
    expect(findDateMentions(text, IN)).toEqual([]);
  });
});

describe("resolveDates: the planner picks, code validates", () => {
  const mentions = findDateMentions("Last Tuesday I asked about Postgres", IN);

  it("without a planner (fallback), chrono's readings are used as-is", () => {
    const { resolved } = resolveDates(mentions, null, { today });
    expect(resolved[0].primary.start).toBe("2026-11-10");
    expect(resolved[0].alternative?.start).toBe("2026-11-03");
  });

  it("the planner can pick the second reading; it stays an alternative unless the planner is sure", () => {
    const medium = resolveDates(mentions, [{ choice: "candidate", mention: 0, reading: 1, confidence: "medium" }], {
      today,
    });
    expect(medium.resolved[0].primary.start).toBe("2026-11-03");
    expect(medium.resolved[0].alternative?.start).toBe("2026-11-10");

    const high = resolveDates(mentions, [{ choice: "candidate", mention: 0, reading: 1, confidence: "high" }], {
      today,
    });
    expect(high.resolved[0].alternative).toBeUndefined();
  });

  it("the planner can reject a false positive", () => {
    const m = findDateMentions("on Monday", IN);
    expect(resolveDates(m, [{ choice: "not_a_date", mention: 0 }], { today }).resolved).toEqual([]);
  });

  it("the planner cannot type a different date for text chrono parsed", () => {
    const own: PlannerDate = { choice: "own", text: "last Tuesday", start: "2026-11-04", confidence: "high" };
    const { resolved } = resolveDates(mentions, [own], { today });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ source: "chrono", primary: { start: "2026-11-10" } });
  });

  it("the planner's own date is used for phrases chrono can't read, after validation", () => {
    const own: PlannerDate = {
      choice: "own",
      text: "the day we discussed CRMs",
      start: "2026-11-09",
      weekday: "Monday",
      confidence: "medium",
    };
    const { resolved } = resolveDates([], [own], { today });
    expect(resolved[0]).toMatchObject({ source: "planner", primary: { start: "2026-11-09", end: "2026-11-09" } });
  });

  it("a contextual phrase wrapping a chrono match is the planner's call", () => {
    const m = findDateMentions("what about the Monday after that?", IN);
    const own: PlannerDate = { choice: "own", text: "the Monday after that", start: "2026-11-02", confidence: "medium" };
    const { resolved } = resolveDates(m, [own], { today });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ source: "planner", primary: { start: "2026-11-02" } });
  });

  it.each([
    ["a weekday that doesn't match the date", { start: "2026-11-09", weekday: "Tuesday" }],
    ["a future date", { start: "2026-11-20" }],
    ["an impossible date", { start: "2026-02-31" }],
    ["a date far in the past", { start: "2019-01-01" }],
    ["an end before the start", { start: "2026-11-05", end: "2026-11-01" }],
  ])("rejects %s and reports it as unresolved", (_, fields) => {
    const own = { choice: "own", text: "that day", confidence: "low", ...fields } as PlannerDate;
    expect(resolveDates([], [own], { today })).toEqual({ resolved: [], unresolved: ["that day"] });
  });
});

describe("timezones", () => {
  it("the user's local day, not the server's", () => {
    // 20:00 UTC on 10 Nov is already 11 Nov in India.
    expect(dayIn(new Date("2026-11-10T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-11");
    expect(dayIn(new Date("2026-11-10T20:00:00Z"), "America/New_York")).toBe("2026-11-10");
  });

  it("a local day becomes the right UTC range", () => {
    expect(toUtcRange({ start: "2026-11-03", end: "2026-11-03", label: "" }, "Asia/Kolkata")).toEqual({
      fromUtc: "2026-11-02T18:30:00.000Z",
      toUtc: "2026-11-03T18:30:00.000Z",
    });
  });

  it("handles daylight-saving changes", () => {
    // New York leaves DST on 1 Nov 2026: midnight is 04:00 UTC before, 05:00 UTC after.
    expect(dayStartUtc("2026-10-31", "America/New_York").toISOString()).toBe("2026-10-31T04:00:00.000Z");
    expect(dayStartUtc("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("buildCalendar", () => {
  it("lists 6 Monday-first weeks ending today", () => {
    const rows = buildCalendar(today).split("\n");
    expect(rows).toHaveLength(6);
    expect(rows[5]).toBe("Mon 9 Nov 2026-11-09 | Tue 10 Nov 2026-11-10 | Wed 11 Nov 2026-11-11 (today)");
    expect(rows[0].startsWith("Mon 5 Oct 2026-10-05")).toBe(true);
  });
});
