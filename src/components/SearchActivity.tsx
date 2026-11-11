"use client";

import type { SearchActivity as Activity } from "@/lib/parts";

/** One compact line for all searches in an answer: live while running, expandable when done. */
export function SearchActivity({ searches }: { searches: Activity[] }) {
  if (!searches.length) return null;
  const queries = searches.flatMap((s) => s.queries);
  const running = searches.some((s) => s.state === "running");
  const failed = searches.filter((s) => s.state === "error");

  if (running) {
    return <p className="animate-pulse text-sm text-neutral-500">Searching: {queries.join(" · ") || "…"}</p>;
  }

  const sources = searches.reduce((n, s) => n + s.sourceCount, 0);
  return (
    <details className="my-1 text-sm text-neutral-500">
      <summary className="cursor-pointer select-none">
        Searched {queries.length} quer{queries.length === 1 ? "y" : "ies"} · {sources} source{sources === 1 ? "" : "s"}
        {failed.length ? ` · ${failed.length} failed` : ""}
      </summary>
      <ul className="mt-1 ml-4 list-disc">
        {searches.map((s, i) => (
          <li key={i}>
            {s.queries.join(" · ")}
            {s.since ? ` (since ${s.since})` : ""}
            {s.state === "error" ? <span className="text-amber-600"> · {s.error ?? "failed"}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
