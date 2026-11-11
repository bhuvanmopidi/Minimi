import type { DateMention, DayRange } from "./candidates";
import { addDays, dayStartUtc, formatDay, isDay, weekdayOf, type Day } from "./zone";

// Step 3 of date handling (ADR-0005): code VALIDATES what the planner decided.
// For text chrono parsed, the planner may only pick a reading or reject it, so the two can never
// disagree on arithmetic. It writes its own date only for text chrono missed, and we check that here.

export type Confidence = "high" | "medium" | "low";

/** One date decision from the planner. Mirrors the planner's output schema. */
export type PlannerDate =
  | { choice: "candidate"; mention: number; reading: number; confidence: Confidence }
  | { choice: "not_a_date"; mention: number }
  | { choice: "own"; text: string; start: string; end?: string; weekday?: string; confidence: Confidence };

export type ResolvedDate = {
  text: string;
  primary: DayRange;
  alternative?: DayRange;
  source: "chrono" | "planner";
};

export type DateResolution = { resolved: ResolvedDate[]; unresolved: string[] };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MAX_LOOKBACK_DAYS = 2 * 366;

/**
 * Combine chrono's mentions with the planner's decisions.
 * `decisions` is null when the planner failed: every chrono mention is then used as-is.
 */
export function resolveDates(
  mentions: DateMention[],
  decisions: PlannerDate[] | null,
  opts: { today: Day },
): DateResolution {
  const resolved: ResolvedDate[] = [];
  const unresolved: string[] = [];
  const handled = new Set<number>();

  for (const d of decisions ?? []) {
    if (d.choice === "own") {
      // The exact text chrono parsed must use chrono's readings: the planner can't override arithmetic.
      if (mentions.some((m) => sameSpan(m.text, d.text))) continue; // chrono default applies below
      // A longer phrase wrapping a chrono match ("the Monday after that" ⊃ "Monday") is context,
      // which is the planner's job: its date wins (if valid) and the inner match is set aside.
      mentions.forEach((m, i) => {
        if (norm(d.text).includes(norm(m.text))) handled.add(i);
      });
      const checked = checkOwnDate(d, opts.today);
      if (checked) resolved.push({ text: d.text, primary: checked, source: "planner" });
      else unresolved.push(d.text);
      continue;
    }

    const mention = mentions[d.mention];
    if (!mention || handled.has(d.mention)) continue;
    handled.add(d.mention);
    if (d.choice === "not_a_date") continue;

    const picked = mention.readings[d.reading] ?? mention.readings[0];
    const other = mention.readings.find((r) => r !== picked);
    resolved.push({
      text: mention.text,
      primary: picked,
      // Unless the planner is sure, keep the other reading so history can settle it.
      alternative: d.confidence === "high" ? undefined : other,
      source: "chrono",
    });
  }

  // Mentions the planner didn't address keep chrono's default reading (safe default).
  mentions.forEach((m, i) => {
    if (!handled.has(i)) {
      resolved.push({ text: m.text, primary: m.readings[0], alternative: m.readings[1], source: "chrono" });
    }
  });

  return { resolved, unresolved };
}

function checkOwnDate(d: Extract<PlannerDate, { choice: "own" }>, today: Day): DayRange | null {
  const end = d.end ?? d.start;
  if (!isDay(d.start) || !isDay(end) || d.start > end) return null;
  if (end > today) return null; // looking back: no future dates
  if (d.start < addDays(today, -MAX_LOOKBACK_DAYS)) return null;
  if (d.weekday) {
    const expected = WEEKDAYS.indexOf(d.weekday.trim().toLowerCase());
    if (expected >= 0 && expected !== weekdayOf(d.start)) return null; // "Tuesday 9 Nov" is wrong
  }
  const label = d.start === end ? formatDay(d.start) : `${formatDay(d.start)} to ${formatDay(end)}`;
  return { start: d.start, end, label };
}

/** Lowercase, collapse spaces, drop a leading preposition: "On  Monday" → "monday". */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(back on|on|in|at|since|from) /, "");
}

function sameSpan(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

/** The user's local days [start, end] as a UTC half-open interval for querying stored timestamps. */
export function toUtcRange(range: DayRange, timeZone: string): { fromUtc: string; toUtc: string } {
  return {
    fromUtc: dayStartUtc(range.start, timeZone).toISOString(),
    toUtc: dayStartUtc(addDays(range.end, 1), timeZone).toISOString(),
  };
}
