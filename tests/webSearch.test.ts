import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "@/memory/db";
import { SearchNotConfiguredError, type SearchHit, type SearchProvider } from "@/tools/tavily";
import { runWebSearch, SourceRegistry, trimSnippet, type SearchLogEntry, type WebSearchDeps } from "@/tools/webSearch";

const hit = (url: string, score = 0.5, content = "Some page text."): SearchHit => ({
  title: `Title of ${url}`,
  url,
  content,
  score,
});

function setup(provider: SearchProvider, start = new Date("2026-11-11T10:00:00Z")) {
  let clock = start;
  const searchLog: SearchLogEntry[] = [];
  const deps: WebSearchDeps = {
    db: openDatabase(":memory:"),
    provider,
    registry: new SourceRegistry(),
    searchLog,
    now: () => clock,
  };
  return { deps, searchLog, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

describe("runWebSearch", () => {
  it("runs queries in parallel, ranks by score and numbers sources", async () => {
    const provider = vi.fn<SearchProvider>(async ({ query }) =>
      query === "neon pricing" ? [hit("https://neon.tech/pricing", 0.9)] : [hit("https://supabase.com/pricing", 0.7)],
    );
    const { deps, searchLog } = setup(provider);

    const out = await runWebSearch({ queries: ["supabase pricing", "neon pricing"] }, deps);

    expect(provider).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({
      results: [
        { n: 1, domain: "neon.tech" },
        { n: 2, domain: "supabase.com" },
      ],
    });
    expect(searchLog.map((s) => s.query)).toEqual(["supabase pricing", "neon pricing"]);
  });

  it("keeps citation numbers stable across calls and merges duplicate URLs", async () => {
    const { deps } = setup(async ({ query }) =>
      query === "first"
        ? [hit("https://a.com/x", 0.9), hit("https://b.com/y", 0.8)]
        : [hit("https://www.b.com/y/?utm_source=z", 0.9), hit("https://c.com/z", 0.5)],
    );

    await runWebSearch({ queries: ["first"] }, deps);
    const second = await runWebSearch({ queries: ["second"] }, deps);

    expect(second).toMatchObject({ results: [{ n: 2, domain: "b.com" }, { n: 3, domain: "c.com" }] });
    expect(deps.registry.list().map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it("serves repeats from the cache for 10 minutes, then fetches again", async () => {
    const provider = vi.fn<SearchProvider>(async () => [hit("https://a.com")]);
    const { deps, advance } = setup(provider);

    await runWebSearch({ queries: ["Neon pricing"] }, deps);
    await runWebSearch({ queries: ["  neon   PRICING "] }, deps); // same query after normalisation
    expect(provider).toHaveBeenCalledTimes(1);

    await runWebSearch({ queries: ["Neon pricing"], since: "2026-11-03" }, deps); // different filter → new key
    expect(provider).toHaveBeenCalledTimes(2);

    advance(11 * 60_000);
    await runWebSearch({ queries: ["Neon pricing"] }, deps);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it("reports partial failures but still returns what worked", async () => {
    const { deps } = setup(async ({ query }) => {
      if (query === "broken") throw new Error("boom");
      return [hit("https://ok.com")];
    });

    const out = await runWebSearch({ queries: ["fine", "broken"] }, deps);
    expect(out).toMatchObject({ results: [{ n: 1 }], failedQueries: ["broken"] });
  });

  it("returns a clear error when every query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = setup(async () => {
      throw new Error("timeout");
    });
    expect(await runWebSearch({ queries: ["a", "b"] }, deps)).toEqual({
      error: "Web search is unavailable right now, so nothing could be checked online.",
    });
  });

  it("says so when search is not configured", async () => {
    const { deps } = setup(async () => {
      throw new SearchNotConfiguredError();
    });
    const out = await runWebSearch({ queries: ["a"] }, deps);
    expect(out).toEqual({ error: expect.stringContaining("not configured") });
  });

  it("passes since and topic through to the provider", async () => {
    const provider = vi.fn<SearchProvider>(async () => []);
    const { deps } = setup(provider);
    await runWebSearch({ queries: ["crm pricing"], since: "2026-11-09", topic: "news" }, deps);
    expect(provider.mock.calls[0][0]).toEqual({ query: "crm pricing", since: "2026-11-09", topic: "news" });
  });
});

describe("trimSnippet", () => {
  it("collapses whitespace and leaves short text alone", () => {
    expect(trimSnippet("a   b\n\n c")).toBe("a b c");
  });

  it("cuts long text at a sentence boundary", () => {
    const text = "First sentence here. ".repeat(10) + "x".repeat(200);
    const out = trimSnippet(text, 150);
    expect(out.endsWith(". …")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(155);
  });
});
