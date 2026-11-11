// Reading a message's parts (shared by the server and the UI). Searches appear in two shapes:
// the model's own `tool-web_search` calls and `data-search` parts for searches run before the answer.
// Both carry the same input/output as src/tools/webSearch.ts.

export type PartSource = { n: number; title?: string; url: string; domain?: string; published?: string };

export type SearchActivity = {
  state: "running" | "done" | "error";
  queries: string[];
  since?: string;
  sourceCount: number;
  error?: string;
};

type AnyPart = { type: string; state?: string; input?: unknown; output?: unknown; errorText?: string; data?: unknown };
type SearchInput = { queries?: string[]; since?: string };
type SearchOutput = { results?: PartSource[]; error?: string };

function searchPayload(part: AnyPart): { state?: string; input?: SearchInput; output?: SearchOutput; errorText?: string } | null {
  if (part.type === "tool-web_search") return part as { state?: string; input?: SearchInput; output?: SearchOutput };
  if (part.type === "data-search") return (part.data ?? null) as { state?: string; input?: SearchInput; output?: SearchOutput };
  return null;
}

/** Every source the message's searches returned, by citation number. */
export function sourcesInParts(parts: readonly unknown[]): PartSource[] {
  const byN = new Map<number, PartSource>();
  for (const p of parts as AnyPart[]) {
    for (const s of searchPayload(p)?.output?.results ?? []) if (!byN.has(s.n)) byN.set(s.n, s);
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

/** One entry per search call, for the compact "Searched 5 queries · 18 sources" line. */
export function searchesInParts(parts: readonly unknown[]): SearchActivity[] {
  const out: SearchActivity[] = [];
  for (const p of parts as AnyPart[]) {
    const s = searchPayload(p);
    if (!s) continue;
    const queries = (s.input?.queries ?? []).filter(Boolean);
    if (s.state === "output-available" && !s.output?.error) {
      out.push({ state: "done", queries, since: s.input?.since, sourceCount: s.output?.results?.length ?? 0 });
    } else if (s.state === "output-error" || s.output?.error) {
      out.push({ state: "error", queries, since: s.input?.since, sourceCount: 0, error: s.output?.error ?? s.errorText });
    } else {
      out.push({ state: "running", queries, since: s.input?.since, sourceCount: 0 });
    }
  }
  return out;
}

/** The citation numbers used in a text: "Neon [1] and Supabase [3][4]" → [1, 3, 4]. */
export function citedNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(/\[(\d{1,3})\](?!\()/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}
