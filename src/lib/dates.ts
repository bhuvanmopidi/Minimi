import { addDays, dayIn, formatDay } from "@/time/zone";

// Labels for the chat's date dividers and message times, in the viewer's timezone.

/** "Today", "Yesterday" or "Tuesday 3 November 2026". */
export function dividerLabel(iso: string, now: Date, timeZone: string): string {
  const day = dayIn(new Date(iso), timeZone);
  const today = dayIn(now, timeZone);
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatDay(day);
}

/** True when `iso` falls on a different local day than `previousIso` (or there is no previous message). */
export function startsNewDay(previousIso: string | undefined, iso: string, timeZone: string): boolean {
  if (!previousIso) return true;
  return dayIn(new Date(previousIso), timeZone) !== dayIn(new Date(iso), timeZone);
}

/** "14:05" */
export function timeLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}
