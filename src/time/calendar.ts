import { addDays, formatDayShort, weekdayOf, type Day } from "./zone";

/**
 * A compact calendar of the last `weeks` weeks (Monday-first rows), given to the planner so it can
 * look weekdays up instead of computing them. LLMs are unreliable at weekday arithmetic.
 *
 *   Mon 9 Nov 2026-11-09 | Tue 10 Nov 2026-11-10 | Wed 11 Nov 2026-11-11 (today)
 */
export function buildCalendar(today: Day, weeks = 6): string {
  const thisMonday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const rows: string[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addDays(thisMonday, -7 * w);
    const cells: string[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d);
      if (day > today) break;
      cells.push(`${formatDayShort(day)} ${day}${day === today ? " (today)" : ""}`);
    }
    rows.push(cells.join(" | "));
  }
  return rows.join("\n");
}
