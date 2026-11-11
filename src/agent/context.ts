import type { StoredClaim } from "@/memory/repo";
import type { FoundConversation, HistoryResult } from "@/memory/retrieval";
import type { Source } from "@/tools/webSearch";
import type { Intent } from "./planner";
import type { DateResolution } from "@/time/validate";
import { formatInstant } from "@/time/zone";

// The per-turn context block (docs/architecture.md, stage ⑨). It is attached to the latest user
// message for the model only. It is never stored, so the conversation history stays clean.
// Everything that changes per turn lives here, including "now", so the system prompt stays
// byte-identical and can be prompt-cached.

// Size budget for prefetched results (~3.5k tokens): best-ranked sources first, the rest dropped.
const SEARCH_RESULTS_BUDGET_CHARS = 14_000;

export function renderContext(opts: {
  nowLabel: string;
  summary?: string | null; // rolling summary of this conversation's older messages
  intent?: Intent;
  dates: DateResolution;
  history: HistoryResult | null; // null when the planner said history isn't needed
  historyFromFallback: boolean;
  search?: { sources: Source[]; errors: string[]; fetchedAt: string } | null; // prefetched before the answer
  timeZone: string;
}): string {
  const sections: string[] = [`<now>${opts.nowLabel}</now>`];
  if (opts.summary) {
    sections.push(`<earlier_in_this_conversation>\n${opts.summary}\n</earlier_in_this_conversation>`);
  }
  if (opts.intent === "recheck") sections.push("<intent>recheck: compare each fact under <facts_then> with the search results</intent>");

  if (opts.dates.resolved.length) {
    const lines = opts.dates.resolved.map(
      (d) => `- "${d.text}" → ${d.primary.label}${d.alternative ? ` (or possibly ${d.alternative.label})` : ""}`,
    );
    sections.push(`<resolved_dates>\n${lines.join("\n")}\n</resolved_dates>`);
  }
  if (opts.dates.unresolved.length) {
    sections.push(
      `<unresolved_dates>${opts.dates.unresolved.map((t) => `"${t}"`).join(", ")}: couldn't work out which day; ask the user if it matters</unresolved_dates>`,
    );
  }

  const h = opts.history;
  if (h && h.status !== "skipped") {
    const auto = opts.historyFromFallback ? ' matching="automatic: may be unrelated, ignore if so"' : "";
    if (h.status === "found") {
      const notes: string[] = [];
      if (h.usedAlternative && h.window) notes.push(`nothing on the first reading of the date; matched ${h.window.label}`);
      if (h.otherDate) notes.push("found the topic, but NOT on the date the user named. Say so");
      const note = notes.length ? ` note="${notes.join("; ")}"` : "";
      sections.push(
        `<history status="found"${note}${auto}>\n${h.conversations.map((c) => renderConversation(c, opts.timeZone)).join("\n")}\n</history>`,
      );
    } else {
      const nearest = h.nearest.length
        ? `\n<nearest_conversations>\n${h.nearest.map((c) => renderConversation(c, opts.timeZone)).join("\n")}\n</nearest_conversations>\n`
        : "";
      sections.push(`<history status="not_found"${auto}>${nearest}</history>`);
    }
  }

  const s = opts.search;
  if (s && (s.sources.length || s.errors.length)) {
    const lines: string[] = [];
    let used = 0;
    for (const src of s.sources) {
      const line = `[${src.n}] ${src.title} (${src.domain}${src.published ? `, published ${src.published}` : ""})\n${src.snippet}`;
      if (used + line.length > SEARCH_RESULTS_BUDGET_CHARS) break;
      lines.push(line);
      used += line.length;
    }
    const errors = s.errors.length ? `\n<search_errors>${s.errors.join("; ")}</search_errors>` : "";
    sections.push(
      `<search_results fetched="${formatInstant(s.fetchedAt, opts.timeZone)}" note="searched for you before answering; cite as [n], search again only if something is missing">\n${lines.join("\n\n")}${errors}\n</search_results>`,
    );
  }

  return `<context>\n${sections.join("\n")}\n</context>`;
}

function renderConversation(c: FoundConversation, timeZone: string): string {
  const exchanges = c.exchanges
    .map(
      (e) =>
        `<exchange at="${formatInstant(e.askedAt, timeZone)}">\n<user_asked>${e.question}</user_asked>` +
        (e.answer ? `\n<you_answered>${e.answer}</you_answered>` : "") +
        (e.claims.length ? `\n<facts_then>\n${e.claims.map(renderClaim).join("\n")}\n</facts_then>` : "") +
        `\n</exchange>`,
    )
    .join("\n");
  return `<conversation title="${escapeAttr(c.title)}">\n${exchanges}\n</conversation>`;
}

/** "- Neon | Launch plan price | $19/month | source neon.tech, 2026-11-01" */
function renderClaim(c: StoredClaim): string {
  let source = "";
  if (c.sourceUrl) {
    try {
      source = ` | source ${new URL(c.sourceUrl).hostname.replace(/^www\./, "")}${c.sourceDate ? `, ${c.sourceDate}` : ""}`;
    } catch {
      source = ` | source ${c.sourceUrl}`;
    }
  }
  return `- ${c.entity} | ${c.attribute} | ${c.value}${source}`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "'");
}
