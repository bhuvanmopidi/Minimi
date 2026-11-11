"use client";

import type { PartSource } from "@/lib/parts";

/** The sources an answer actually cited, numbered to match the [n] chips in the text. */
export function Sources({ cited }: { cited: PartSource[] }) {
  if (!cited.length) return null;
  return (
    <div className="mt-3 border-t border-neutral-200 pt-2 text-sm dark:border-neutral-800">
      <p className="mb-1 font-medium text-neutral-500">Sources</p>
      <ol className="space-y-0.5">
        {cited.map((s) => (
          <li key={s.n} className="flex gap-2">
            <span className="w-6 shrink-0 text-right text-neutral-500">{s.n}.</span>
            <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">
              {s.title ?? s.url}
              <span className="text-neutral-500">
                {" "}
                · {s.domain ?? new URL(s.url).hostname}
                {s.published ? ` · ${s.published}` : ""}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
