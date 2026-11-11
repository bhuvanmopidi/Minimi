import { describe, expect, it } from "vitest";
import { citationNumber, linkCitations } from "@/lib/citations";
import { dividerLabel, startsNewDay, timeLabel } from "@/lib/dates";
import { citedNumbers, searchesInParts, sourcesInParts } from "@/lib/parts";

describe("citations", () => {
  it("turns [n] into citation links, including adjacent ones", () => {
    expect(linkCitations("Neon is $15 [1][2].")).toBe("Neon is $15 [1](#cite-1)[2](#cite-2).");
  });

  it("leaves real markdown links alone", () => {
    expect(linkCitations("see [3](https://x.com) and [docs](https://y.com)")).toBe(
      "see [3](https://x.com) and [docs](https://y.com)",
    );
  });

  it("reads the number back from the link and ignores other links", () => {
    expect(citationNumber("#cite-12")).toBe(12);
    expect(citationNumber("https://example.com")).toBeNull();
    expect(citationNumber(undefined)).toBeNull();
  });

  it("lists the numbers an answer cites, once each, in order", () => {
    expect(citedNumbers("A [3], B [1][3], link [2](https://x.com)")).toEqual([1, 3]);
  });
});

describe("reading parts", () => {
  const parts = [
    { type: "data-memory", data: { state: "done" } },
    {
      type: "data-search",
      data: {
        state: "output-available",
        input: { queries: ["neon price", "supabase price"] },
        output: { results: [{ n: 1, url: "https://neon.com" }, { n: 2, url: "https://supabase.com" }] },
      },
    },
    {
      type: "tool-web_search",
      state: "output-available",
      input: { queries: ["railway price"], since: "2026-11-03" },
      output: { results: [{ n: 2, url: "https://supabase.com" }, { n: 3, url: "https://railway.com" }] },
    },
    { type: "tool-web_search", state: "output-available", input: { queries: ["x"] }, output: { error: "Web search is unavailable" } },
    { type: "tool-web_search", state: "input-available", input: { queries: ["still running"] } },
    { type: "text", text: "…" },
  ];

  it("collects every source across searches run before the answer and tool calls", () => {
    expect(sourcesInParts(parts).map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it("summarises each search: done, failed, running", () => {
    expect(searchesInParts(parts)).toEqual([
      { state: "done", queries: ["neon price", "supabase price"], since: undefined, sourceCount: 2 },
      { state: "done", queries: ["railway price"], since: "2026-11-03", sourceCount: 2 },
      { state: "error", queries: ["x"], since: undefined, sourceCount: 0, error: "Web search is unavailable" },
      { state: "running", queries: ["still running"], since: undefined, sourceCount: 0 },
    ]);
  });
});

describe("date dividers", () => {
  const now = new Date("2026-11-11T10:00:00Z");

  it("says Today / Yesterday, then the full date", () => {
    expect(dividerLabel("2026-11-11T08:00:00Z", now, "Asia/Kolkata")).toBe("Today");
    expect(dividerLabel("2026-11-10T08:00:00Z", now, "Asia/Kolkata")).toBe("Yesterday");
    expect(dividerLabel("2026-11-03T06:00:00Z", now, "Asia/Kolkata")).toBe("Tuesday 3 November 2026");
  });

  it("splits by the viewer's local day, not UTC", () => {
    // 18:00 and 20:00 UTC on 10 Nov are 23:30 on 10 Nov and 01:30 on 11 Nov in India.
    expect(startsNewDay("2026-11-10T18:00:00Z", "2026-11-10T20:00:00Z", "Asia/Kolkata")).toBe(true);
    expect(startsNewDay("2026-11-10T18:00:00Z", "2026-11-10T20:00:00Z", "UTC")).toBe(false);
    expect(startsNewDay(undefined, "2026-11-10T20:00:00Z", "UTC")).toBe(true);
  });

  it("shows times in the viewer's timezone", () => {
    expect(timeLabel("2026-11-03T06:10:00Z", "Asia/Kolkata")).toBe("11:40");
  });
});
