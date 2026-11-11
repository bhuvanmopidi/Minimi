import type { ModelMessage } from "ai";
import type { MessageRow } from "@/memory/repo";

// Stored messages → what the model reads for the current conversation (docs/architecture.md, stage ④).

const SOURCED_ANSWERS = 3; // the last N answers keep a compact list of their sources
const MAX_SOURCES_PER_ANSWER = 8;

type SourceLike = { n: number; title?: string; url: string };

/** The sources an answer used, from its saved parts (tool calls and searches run before the answer). */
export function sourcesFromParts(partsJson: string | null): SourceLike[] {
  if (!partsJson) return [];
  try {
    const parts = JSON.parse(partsJson) as { type: string; output?: unknown; data?: { output?: unknown } }[];
    const byN = new Map<number, SourceLike>();
    for (const p of parts) {
      const output = (p.type === "tool-web_search" ? p.output : p.type === "data-search" ? p.data?.output : null) as
        | { results?: SourceLike[] }
        | null;
      for (const s of output?.results ?? []) if (!byN.has(s.n)) byN.set(s.n, s);
    }
    return [...byN.values()].sort((a, b) => a.n - b.n);
  } catch {
    return [];
  }
}

/**
 * - Starts the window at a user message (the API requires the conversation to start with one).
 * - Appends to recent answers the sources their [n] citations point at, so follow-ups like
 *   "what was source 3?" or "open the second link" work.
 * - Attaches the per-turn context block to the latest user message (never stored).
 */
export function toModelMessages(window: MessageRow[], context: string | null): ModelMessage[] {
  const start = window.findIndex((m) => m.role === "user");
  const rows = start < 0 ? [] : window.slice(start);
  const answerIndexes = rows.flatMap((m, i) => (m.role === "assistant" ? [i] : [])).slice(-SOURCED_ANSWERS);

  return rows.map((m, i) => {
    if (m.role === "assistant" && answerIndexes.includes(i)) {
      const cited = sourcesFromParts(m.parts_json)
        .filter((s) => m.content.includes(`[${s.n}]`))
        .slice(0, MAX_SOURCES_PER_ANSWER);
      const list = cited.length ? `\n\n(Sources for this answer: ${cited.map((s) => `[${s.n}] ${s.url}`).join(" · ")})` : "";
      return { role: "assistant", content: `${m.content}${list}` };
    }
    const isLatest = i === rows.length - 1;
    return { role: m.role, content: isLatest && context ? `${context}\n\n${m.content}` : m.content };
  });
}
