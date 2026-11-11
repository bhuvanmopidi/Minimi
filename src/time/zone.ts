// Calendar-day helpers. A "Day" is a local calendar date in the user's timezone, as "YYYY-MM-DD".
// Day arithmetic is done on UTC dates so it never shifts with the server's timezone or DST.

export type Day = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isDay(value: unknown): value is Day {
  if (typeof value !== "string") return false;
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function makeDay(year: number, month: number, day: number): Day {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function toUtcDate(day: Day): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: Day, n: number): Day {
  return new Date(toUtcDate(day).getTime() + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(day: Day): number {
  return toUtcDate(day).getUTCDay();
}

export function daysBetween(a: Day, b: Day): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / MS_PER_DAY);
}

/** The user's local calendar date at `instant`. */
export function dayIn(instant: Date, timeZone: string): Day {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +330 for Asia/Kolkata). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** The UTC instant at which `day` starts (local midnight) in `timeZone`. DST-safe. */
export function dayStartUtc(day: Day, timeZone: string): Date {
  const guess = toUtcDate(day).getTime();
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  // Re-check at the result: the offset can differ across a DST change.
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60_000;
  return new Date(instant);
}

/** "Tuesday 3 November 2026". Built from parts: punctuation from Intl.format varies across ICU versions. */
export function formatDay(day: Day): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(toUtcDate(day));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
}

/** "Tue 3 Nov" */
export function formatDayShort(day: Day): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    toUtcDate(day),
  );
}

/** A stored UTC timestamp shown in the user's timezone: "Tuesday 3 November 2026, 11:42". */
export function formatInstant(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    instant,
  );
  return `${formatDay(dayIn(instant, timeZone))}, ${time}`;
}
