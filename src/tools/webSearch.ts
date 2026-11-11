import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { tool } from "ai";
import { z } from "zod";
import { newId } from "@/memory/ids";
import { SearchNotConfiguredError, type SearchHit, type SearchProvider, type SearchTopic } from "./tavily";

const SEARCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60_000;
const SNIPPET_CHARS = 700;

/** What the model sees for each result. `n` is the citation number, stable for the whole turn. */
export type Source = { n: number; title: string; url: string; domain: string; published?: string; snippet: string };

/** A search we ran, kept until the answer is saved (searches.message_id must point at a saved message). */
export type SearchLogEntry = {
  id: string;
  query: string;
  since?: string;
  resultsJson: string;
  fetchedAt: string;
};

export type WebSearchOutput =
  | { results: Source[]; failedQueries?: string[] }
  | { error: string };

/**
 * Numbers sources across every search in one turn, so [3] never means two different pages
 * even when the model searches several times. Duplicate URLs keep their first number.
 */
export class SourceRegistry {
  private byUrl = new Map<string, Source>();

  add(hit: SearchHit, query = ""): Source {
    const key = normalizeUrl(hit.url);
    const existing = this.byUrl.get(key);
    if (existing) return existing;
    const source: Source = {
      n: this.byUrl.size + 1,
      title: hit.title,
      url: hit.url,
      domain: domainOf(hit.url),
      published: hit.published,
      snippet: selectPassages(hit.content, query),
    };
    this.byUrl.set(key, source);
    return source;
  }

  list(): Source[] {
    return [...this.byUrl.values()];
  }
}

export type WebSearchDeps = {
  db: Database.Database;
  provider: SearchProvider;
  registry: SourceRegistry;
  searchLog: SearchLogEntry[];
  now: () => Date;
  abortSignal?: AbortSignal;
};

export const webSearchInput = z.object({
  queries: z
    .array(z.string().trim().min(2).max(300))
    .min(1)
    .max(4)
    .describe("1-4 focused search queries; they run in parallel. Use several for comparisons."),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Only results published on or after this date (YYYY-MM-DD). Use for 'what changed since…'."),
  topic: z
    .enum(["general", "news"])
    .optional()
    .describe("'news' for recent events and announcements; 'general' otherwise (default)."),
});

export type WebSearchInput = z.infer<typeof webSearchInput>;

export async function runWebSearch(input: WebSearchInput, deps: WebSearchDeps): Promise<WebSearchOutput> {
  const topic: SearchTopic = input.topic ?? "general";
  const queries = [...new Set(input.queries.map((q) => q.trim()))];

  type Outcome = { ok: true; query: string; hits: SearchHit[] } | { ok: false; query: string; error: Error };
  const outcomes = await Promise.all(
    queries.map(async (query): Promise<Outcome> => {
      try {
        return { ok: true, query, hits: await searchOne(query, input.since, topic, deps) };
      } catch (error) {
        return { ok: false, query, error: error as Error };
      }
    }),
  );

  const failed = outcomes.filter((o): o is Extract<Outcome, { ok: false }> => !o.ok);
  if (failed.length === outcomes.length) {
    const notConfigured = failed.some((o) => o.error instanceof SearchNotConfiguredError);
    if (!notConfigured) console.error("[web_search] all queries failed", failed.map((o) => o.error.message));
    return {
      error: notConfigured
        ? "Web search is not configured on this server, so nothing could be checked online."
        : "Web search is unavailable right now, so nothing could be checked online.",
    };
  }

  // Best results first across all queries, then number them in that order.
  const hits = outcomes
    .flatMap((o) => (o.ok ? o.hits.map((hit) => ({ hit, query: o.query })) : []))
    .sort((a, b) => b.hit.score - a.hit.score);
  const results = uniqueByN(hits.map(({ hit, query }) => deps.registry.add(hit, query)));

  return failed.length ? { results, failedQueries: failed.map((o) => o.query) } : { results };
}

async function searchOne(
  query: string,
  since: string | undefined,
  topic: SearchTopic,
  deps: WebSearchDeps,
): Promise<SearchHit[]> {
  const key = cacheKey(query, since, topic);
  const cached = readCache(deps.db, key, deps.now());
  if (cached) return cached;

  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const signal = deps.abortSignal ? AbortSignal.any([timeout, deps.abortSignal]) : timeout;
  const hits = await deps.provider({ query, since, topic }, signal);

  const fetchedAt = deps.now();
  writeCache(deps.db, key, hits, fetchedAt);
  deps.searchLog.push({
    id: newId("srch"),
    query,
    since,
    resultsJson: JSON.stringify(hits),
    fetchedAt: fetchedAt.toISOString(),
  });
  return hits;
}

export function createWebSearchTool(deps: Omit<WebSearchDeps, "abortSignal">) {
  return tool({
    description:
      "Search the web. Returns numbered sources [n] with title, domain, publish date (when known) and a snippet. " +
      "Use for anything time-sensitive or that you are not certain about: prices, plans, releases, news, people, companies.",
    inputSchema: webSearchInput,
    execute: (input, { abortSignal }) => runWebSearch(input, { ...deps, abortSignal }),
  });
}

// --- cache -------------------------------------------------------------------------------------

export function cacheKey(query: string, since: string | undefined, topic: SearchTopic): string {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${normalized}|${since ?? ""}|${topic}`).digest("hex");
}

function readCache(db: Database.Database, key: string, at: Date): SearchHit[] | null {
  const row = db.prepare("SELECT results_json, expires_at FROM search_cache WHERE key = ?").get(key) as
    | { results_json: string; expires_at: string }
    | undefined;
  if (!row || row.expires_at <= at.toISOString()) return null;
  return JSON.parse(row.results_json) as SearchHit[];
}

function writeCache(db: Database.Database, key: string, hits: SearchHit[], at: Date): void {
  const expires = new Date(at.getTime() + CACHE_TTL_MS).toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM search_cache WHERE expires_at <= ?").run(at.toISOString());
    db.prepare(
      `INSERT INTO search_cache (key, results_json, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET results_json = excluded.results_json, expires_at = excluded.expires_at`,
    ).run(key, JSON.stringify(hits), expires);
  })();
}

// --- helpers -----------------------------------------------------------------------------------

// Prices, amounts and rates: what most "how much / what changed" questions turn on.
const FIGURE = /[₹$€£¥]\s?\d|\b(?:rs\.?|inr|usd|eur)\s?\d|\d[\d,.]*\s?(?:%|\/\s?(?:mo|month|yr|year|user|seat)|per\s+(?:month|year|user|seat|gb|hour))|\b\d+(?:\.\d+)?\s?(?:gb|tb|mb|cu-hours?|vcpus?|credits)\b/i;

/**
 * Pick the most useful passages of a result instead of its first N characters. Seen live: a shop
 * page had five prices after character 700, and the answer said "no price in the snippet".
 * Passages that contain figures or the query's words win; the opening passage is always kept for
 * context; the chosen passages stay in page order, with "…" marking gaps.
 */
export function selectPassages(text: string, query: string, max = SNIPPET_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;

  // Sentences, table cells and Tavily's chunk separators are natural passage boundaries. A full stop
  // only ends a sentence when a capital follows, so "Rs. 14,599" stays together. Shop pages repeat
  // product names many times, so identical passages are kept once.
  const seen = new Set<string>();
  const passages = clean
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])|\s+\|\s+|\s*\[\.\.\.\]\s*|\s+\.\.\.\s+/)
    .flatMap((p) => (p.length > 240 ? p.match(/.{1,240}(?:\s|$)/g) ?? [p] : [p]))
    .map((p) => p.trim())
    .filter((p) => p && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
  const score = (p: string) => {
    const lower = p.toLowerCase();
    return (FIGURE.test(p) ? 3 : 0) + terms.filter((t) => lower.includes(t)).length;
  };

  const chosen = new Set<number>([0]);
  let used = passages[0].length;
  const ranked = passages
    .map((p, i) => ({ i, s: score(p) }))
    .filter(({ i, s }) => i > 0 && s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  for (const { i } of ranked) {
    if (used + passages[i].length + 3 > max) continue;
    chosen.add(i);
    used += passages[i].length + 3;
  }
  // Nothing scored: fall back to a clean cut of the start.
  if (chosen.size === 1) return trimSnippet(clean, max);

  const order = [...chosen].sort((a, b) => a - b);
  return order.map((i, k) => (k > 0 && i !== order[k - 1] + 1 ? `… ${passages[i]}` : passages[i])).join(" ");
}

/** Collapse whitespace and cut at a sentence boundary near the limit, so the model gets clean text. */
export function trimSnippet(text: string, max = SNIPPET_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut.trimEnd()) + " …";
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (p.startsWith("utm_")) u.searchParams.delete(p);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function uniqueByN(sources: Source[]): Source[] {
  const seen = new Set<number>();
  return sources.filter((s) => !seen.has(s.n) && seen.add(s.n));
}
