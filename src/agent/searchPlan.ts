import type { HistoryResult } from "@/memory/retrieval";
import type { WebSearchInput } from "@/tools/webSearch";
import type { Plan } from "./planner";

// Searches run BEFORE the answer starts (ADR-0012), from two places:
//  1. the planner's own searches;
//  2. for re-checks, one search per fact recorded in the claims ledger. The planner can't know which
//     five CRM tools were on Monday's list, but the ledger does.
// Grouped into tool-sized batches (≤4 queries sharing since/topic), which all run in parallel.

const MAX_QUERIES = 8;
const BATCH = 4;

export function buildPrefetch(plan: Plan, history: HistoryResult | null): WebSearchInput[] {
  const wanted: { query: string; since?: string; topic: "general" | "news" }[] = [...plan.searches];

  if (plan.intent === "recheck" && history?.status === "found") {
    const seen = new Set<string>();
    for (const c of history.conversations.flatMap((conv) => conv.exchanges.flatMap((e) => e.claims))) {
      const key = `${c.entity} ${c.attribute}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Current state, not news: pricing and plan pages often carry no publish date, so no `since`.
      wanted.push({ query: `${c.entity} ${c.attribute}`, topic: "general" });
    }
  }

  const unique = new Map<string, (typeof wanted)[number]>();
  for (const w of wanted) {
    const key = `${w.query.toLowerCase().replace(/\s+/g, " ").trim()}|${w.since ?? ""}|${w.topic}`;
    if (!unique.has(key)) unique.set(key, w);
  }

  // Batch by (since, topic) so each batch is one valid web_search input.
  const groups = new Map<string, WebSearchInput>();
  const batches: WebSearchInput[] = [];
  for (const w of [...unique.values()].slice(0, MAX_QUERIES)) {
    const groupKey = `${w.since ?? ""}|${w.topic}`;
    let batch = groups.get(groupKey);
    if (!batch || batch.queries.length >= BATCH) {
      batch = { queries: [], since: w.since, topic: w.topic };
      groups.set(groupKey, batch);
      batches.push(batch);
    }
    batch.queries.push(w.query);
  }
  return batches;
}
