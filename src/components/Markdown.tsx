"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { citationNumber, linkCitations } from "@/lib/citations";
import type { PartSource } from "@/lib/parts";

/**
 * An answer rendered as markdown (tables, lists, bold, links), with [n] citations as chips.
 * Raw HTML is skipped: text that came from web pages can never inject markup into the app.
 */
export function Markdown({ text, sources }: { text: string; sources: Map<number, PartSource> }) {
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert prose-p:my-2 prose-li:my-0.5 prose-table:my-3 prose-th:px-2 prose-td:px-2 prose-headings:mt-4 prose-headings:mb-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const n = citationNumber(href);
            if (n !== null) return <Citation n={n} source={sources.get(n)} />;
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          // Wide comparison tables scroll sideways instead of widening the page on phones.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
}

function Citation({ n, source }: { n: number; source?: PartSource }) {
  if (!source) return <span className="text-neutral-500">[{n}]</span>;
  const tip = `${source.title ?? source.url}${source.domain ? ` · ${source.domain}` : ""}${source.published ? ` · ${source.published}` : ""}`;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={tip}
      className="mx-0.5 inline-block rounded bg-neutral-200 px-1 align-super text-[0.65em] leading-tight font-medium text-neutral-700 no-underline hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600"
    >
      {/* Hidden brackets: copied text reads "[1][2]" instead of "12", and screen readers say "[1]". */}
      <span className="sr-only">[</span>
      {n}
      <span className="sr-only">]</span>
    </a>
  );
}
