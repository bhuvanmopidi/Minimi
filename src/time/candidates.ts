import * as chrono from "chrono-node";
import { addDays, daysBetween, formatDay, makeDay, weekdayOf, type Day } from "./zone";

// Step 1 of date handling (ADR-0005): code PROPOSES. chrono-node finds date expressions and we turn
// each into one or two concrete readings. The planner later picks between them; it never computes dates.

export type DayRange = { start: Day; end: Day; label: string };

/** One date expression in the user's text, with its possible readings (most likely first). */
export type DateMention = { text: string; readings: DayRange[] };

// Regions that write numeric dates month-first (3/10/26 = March 10). Everyone else is day-first.
const MONTH_FIRST_REGIONS = new Set(["US", "PH", "PR", "GU", "AS", "MP", "VI", "UM", "FM", "MH", "PW", "BZ"]);

export function isMonthFirst(locale: string): boolean {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region ? MONTH_FIRST_REGIONS.has(region) : false;
  } catch {
    return false;
  }
}

const NUMERIC_DATE = /^\d{1,2}[/.\-]\d{1,2}([/.\-]\d{2,4})?$/;

/**
 * Find date mentions in `text`, read relative to `today` (the user's local date).
 * Readings that would be in the future are pulled into the past where the wording allows it
 * ("this Tuesday", "25 December"), because people mostly refer back to things.
 */
export function findDateMentions(text: string, opts: { today: Day; locale: string }): DateMention[] {
  const monthFirst = isMonthFirst(opts.locale);
  const primary = monthFirst ? chrono.en.casual : chrono.en.GB;
  const other = monthFirst ? chrono.en.GB : chrono.en.casual;
  // Noon UTC on the user's local date, parsed with timezone 0: chrono then reasons purely in local days.
  const ref = { instant: new Date(`${opts.today}T12:00:00Z`), timezone: 0 };

  // chrono reads "3/10/26" but not "3.10.26"; swapping the dots keeps the text the same length.
  // Lookalikes such as version numbers become candidates too; the planner rejects those (not_a_date).
  const normalized = text.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{2})\b/g, "$1/$2/$3");

  const mentions: DateMention[] = [];
  for (const result of primary.parse(normalized, ref, { forwardDate: false })) {
    const readings = readingsFor(result, opts.today);
    if (!readings.length) continue;

    // Ambiguous numeric dates (3-10-26): add the other day/month order as a second reading.
    const bare = result.text.trim();
    if (NUMERIC_DATE.test(bare)) {
      const alt = other.parse(bare, ref, { forwardDate: false })[0];
      const altReadings = alt ? readingsFor(alt, opts.today) : [];
      if (altReadings[0] && altReadings[0].start !== readings[0].start) readings.push(altReadings[0]);
    }

    mentions.push({ text: result.text, readings: preferPast(readings, opts.today) });
  }
  return mentions;
}

function readingsFor(result: chrono.ParsedResult, today: Day): DayRange[] {
  const c = result.start;
  const certain = (k: chrono.Component) => c.isCertain(k);
  // A bare time ("at 4 pm") isn't a date reference.
  if (!certain("day") && !certain("weekday") && !certain("month")) return [];

  let day = makeDay(c.get("year")!, c.get("month")!, c.get("day")!);
  const phrase = result.text.toLowerCase();

  // "last week", "2 weeks ago" → that whole Monday–Sunday week.
  if (/\bweeks?\b/.test(phrase)) {
    const monday = addDays(day, -((weekdayOf(day) + 6) % 7));
    return [range(monday, clip(addDays(monday, 6), today), `the week of ${formatDay(monday)}`)];
  }

  // "last month", "in October" → that whole month.
  if (!certain("day") && !certain("weekday")) {
    let year = c.get("year")!;
    const month = c.get("month")!;
    if (!certain("year") && makeDay(year, month, 1) > today) year -= 1;
    const first = makeDay(year, month, 1);
    const last = addDays(makeDay(month === 12 ? year + 1 : year, (month % 12) + 1, 1), -1);
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(
      new Date(`${first}T00:00:00Z`),
    );
    return [range(first, clip(last, today), label)];
  }

  // Weekday only ("Monday", "this Tuesday", "last Tuesday").
  if (certain("weekday") && !certain("day")) {
    if (day > today) day = addDays(day, -7);
    const readings = [single(day)];
    // "last Tuesday" said on a Wednesday could mean yesterday or the week before: keep both.
    if (/\blast\b/.test(phrase) && daysBetween(day, today) < 7) readings.push(single(addDays(day, -7)));
    return readings;
  }

  // A specific day. Without an explicit year, "25 December" means the most recent one.
  if (!certain("year") && day > today) day = makeDay(c.get("year")! - 1, c.get("month")!, c.get("day")!);
  return [single(day)];
}

/** Drop future readings when a past one exists: people look back far more often than forward. */
function preferPast(readings: DayRange[], today: Day): DayRange[] {
  const past = readings.filter((r) => r.start <= today);
  return past.length ? past : readings;
}

function single(day: Day): DayRange {
  return range(day, day, formatDay(day));
}

function range(start: Day, end: Day, label: string): DayRange {
  return { start, end, label };
}

function clip(day: Day, today: Day): Day {
  return day > today ? today : day;
}
