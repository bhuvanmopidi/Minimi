# 0005: Dates. Code proposes, LLM picks, code validates

**Status:** Accepted

## Context
A wrong date is a nasty bug here: the agent confidently says "you didn't ask me anything that day".
Users write dates in many ways: "Monday", "last Tuesday", "3 November", "3-10-26", "the day we
discussed CRMs".

## Options

| | A. Code only (chrono-node) | B. LLM only | **C. Hybrid (chosen)** |
|---|---|---|---|
| Common formats | ✅ exact | ✅ usually | ✅ exact |
| Weekday/date arithmetic | ✅ never wrong | ⚠️ LLMs often slip | ✅ code does it |
| Fuzzy or contextual dates | ❌ can't | ✅ | ✅ |
| Deterministic and unit-testable | ✅ | ⚠️ | ✅ for the code part |

## Decision: Option C, "LLM for language, code for arithmetic"
1. **chrono-node proposes candidates**, using the user's locale (day-first for en-IN/en-GB,
   month-first for en-US). Ambiguous text keeps both readings.
2. **The planner decides** what each date means. It is given now, timezone, locale, a 6-week mini
   calendar (so it never computes weekdays) and chrono's candidates.
3. **Code validates** and converts the user's local day into a UTC range for the database.
4. **History settles leftover ambiguity**: both readings are searched, and a match decides.
5. **The answer always restates the date in words** ("Saturday 3 October 2026"), so a misread is visible.

### Disagreement rule (by construction)
For text chrono parsed, the planner can only `pick` a candidate index or mark it `not_a_date`
(e.g. "Postgres **16**", "**May** I ask"). It **cannot** type a different date for that text, so
code and LLM cannot disagree on arithmetic. The planner writes its own date (`own`) only when chrono
found nothing ("the Tuesday before Diwali", "the Monday after that"). Code checks those: a real date,
not in the future when looking back, a sane window, and the weekday matches the calendar. If a check
fails, code falls back to chrono's candidate, or the model is told the date is unresolved and asks
the user. Low confidence means both readings are searched.

### Numeric date rules
| Input | Result |
|---|---|
| `3-10-26` (en-IN) | 3 Oct 2026 first, 10 Mar 2026 as the alternative |
| `13-10-26` | 13 Oct only (13 can't be a month) |
| `2026-10-03` | ISO, never ambiguous |
| `3 Oct` (no year) | most recent past 3 Oct |
| two-digit year `26` | 2026 |
| a reading in the future when looking back | dropped |

## Consequences
- The request carries `locale` as well as `timeZone`.
- Phase 2 unit tests cover all of the above.
