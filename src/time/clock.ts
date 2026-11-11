import { config } from "@/config";

// All "what time is it" questions go through here so MOCK_NOW can freeze time for tests and demos.
export function now(): Date {
  if (config.mockNow) {
    const fixed = new Date(config.mockNow);
    if (!Number.isNaN(fixed.getTime())) return fixed;
  }
  return new Date();
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(locale: unknown): locale is string {
  if (typeof locale !== "string" || !locale) return false;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

/** e.g. "Wednesday, 11 November 2026, 14:05 (Asia/Kolkata)" */
export function describeNow(date: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${formatted} (${timeZone})`;
}
