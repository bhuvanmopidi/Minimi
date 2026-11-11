import type { FoundConversation, HistoryResult } from "@/memory/retrieval";
import type { DateResolution } from "@/time/validate";
import { formatInstant } from "@/time/zone";

// The per-turn context block (docs/architecture.md, stage ⑨). It is attached to the latest user
// message for the model only. It is never stored, so the conversation history stays clean.

export function renderContext(opts: {
  dates: DateResolution;
  history: HistoryResult | null; // null when the planner said history isn't needed
  historyFromFallback: boolean;
  timeZone: string;
}): string | null {
  const sections: string[] = [];

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

  return sections.length ? `<context>\n${sections.join("\n")}\n</context>` : null;
}

function renderConversation(c: FoundConversation, timeZone: string): string {
  const exchanges = c.exchanges
    .map(
      (e) =>
        `<exchange at="${formatInstant(e.askedAt, timeZone)}">\n<user_asked>${e.question}</user_asked>` +
        (e.answer ? `\n<you_answered>${e.answer}</you_answered>` : "") +
        `\n</exchange>`,
    )
    .join("\n");
  return `<conversation title="${escapeAttr(c.title)}">\n${exchanges}\n</conversation>`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "'");
}
