// Minimal Tavily client over its REST API (one POST endpoint), so we control timeouts and parameters
// directly and avoid the SDK's zod-4 peer dependency. See docs/decisions/0010-web-search-tool.md.

export type SearchTopic = "general" | "news";

export type SearchRequest = { query: string; since?: string; topic: SearchTopic };

export type SearchHit = {
  title: string;
  url: string;
  content: string;
  published?: string; // Tavily only returns publish dates for topic "news"
  score: number;
};

/** Anything that can run one query. The real one is Tavily; tests pass a fake. */
export type SearchProvider = (req: SearchRequest, signal: AbortSignal) => Promise<SearchHit[]>;

type TavilyResponse = {
  results?: { title?: string; url?: string; content?: string; published_date?: string; score?: number }[];
};

export function createTavilyProvider(apiKey: string | undefined): SearchProvider {
  return async (req, signal) => {
    if (!apiKey) throw new SearchNotConfiguredError();
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: req.query,
        topic: req.topic,
        // "advanced" picks the most relevant passages per page: worth ~0.5s for exact prices and plan names.
        search_depth: "advanced",
        chunks_per_source: 3,
        max_results: 5,
        include_answer: false,
        ...(req.since ? { start_date: req.since } : {}),
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as TavilyResponse;
    return (data.results ?? [])
      .filter((r) => r.url && r.content)
      .map((r) => ({
        title: r.title?.trim() || r.url!,
        url: r.url!,
        content: r.content!,
        published: r.published_date ? r.published_date.slice(0, 10) : undefined,
        score: r.score ?? 0,
      }));
  };
}

export class SearchNotConfiguredError extends Error {
  constructor() {
    super("Web search is not configured (TAVILY_API_KEY is missing).");
  }
}
