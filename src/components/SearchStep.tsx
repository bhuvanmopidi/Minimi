"use client";

// Renders one web_search tool call: a live "Searching: …" line, then the sources it found.
// Shapes mirror WebSearchInput / WebSearchOutput in src/tools/webSearch.ts.

type Source = { n: number; title: string; url: string; domain: string; published?: string };
type Output = { results?: Source[]; failedQueries?: string[]; error?: string };

export type SearchPart = {
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: { queries?: string[]; since?: string };
  output?: unknown;
  errorText?: string;
};

export function SearchStep({ part }: { part: SearchPart }) {
  const queries = part.input?.queries?.filter(Boolean) ?? [];
  const label = queries.length ? queries.join(" · ") : "…";
  const since = part.input?.since ? ` (since ${part.input.since})` : "";

  if (part.state === "input-streaming" || part.state === "input-available") {
    return <p className="animate-pulse text-sm text-neutral-500">Searching: {label}{since}</p>;
  }

  const output = (part.output ?? {}) as Output;
  if (part.state === "output-error" || output.error) {
    return <p className="text-sm text-amber-600">Search failed: {output.error ?? part.errorText ?? "unknown error"}</p>;
  }

  const results = output.results ?? [];
  return (
    <div className="my-2 space-y-1">
      <p className="text-sm text-neutral-500">
        Searched: {label}{since}, {results.length} source{results.length === 1 ? "" : "s"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {results.map((s) => (
          <a
            key={s.n}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={s.title}
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            [{s.n}] {s.domain}
            {s.published ? ` · ${s.published}` : ""}
          </a>
        ))}
      </div>
    </div>
  );
}
