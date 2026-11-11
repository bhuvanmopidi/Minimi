import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { config } from "@/config";
import type { DateMention } from "@/time/candidates";
import type { PlannerDate } from "@/time/validate";

// Plan-then-execute (ADR-0002): ONE fast structured call that decides, and calls nothing.
// Phase 2 scope: does this turn need past conversations, what to look for, and what the dates mean.

const PLANNER_TIMEOUT_MS = 6_000;

export type Plan = { needsHistory: boolean; historyQuery: string; dates: PlannerDate[] | null };
export type PlanResult = { plan: Plan; source: "planner" | "fallback"; ms: number };

export type PlanInput = {
  message: string;
  recentTurns: { role: "user" | "assistant"; content: string }[];
  nowLabel: string;
  locale: string;
  monthFirst: boolean;
  calendar: string;
  mentions: DateMention[];
};

// Flat on purpose: optional fields are easier for a small model than a discriminated union.
const PlanSchema = z.object({
  needsHistory: z.boolean().describe("true if answering needs the user's PAST conversations"),
  historyQuery: z
    .string()
    .describe("2-6 keywords naming the topic to look for in past chats; empty if the user only refers to a date"),
  dates: z
    .array(
      z.object({
        choice: z.enum(["candidate", "not_a_date", "own"]),
        mention: z.number().int().optional().describe("index of the detected mention (candidate / not_a_date)"),
        reading: z.number().int().optional().describe("index of the chosen reading (candidate)"),
        text: z.string().optional().describe("the exact phrase (own)"),
        start: z.string().optional().describe("YYYY-MM-DD, looked up in the calendar (own)"),
        end: z.string().optional().describe("YYYY-MM-DD if a range (own)"),
        weekday: z.string().optional().describe("weekday of start, from the calendar (own)"),
        confidence: z.enum(["high", "medium", "low"]).optional(),
      }),
    )
    .describe("one entry per detected mention, plus 'own' entries for past-date phrases that were not detected"),
});

type RawPlan = z.infer<typeof PlanSchema>;
export type GeneratePlan = (system: string, prompt: string, signal: AbortSignal) => Promise<RawPlan>;

const SYSTEM = `You plan how a chat assistant with memory should handle the user's latest message. You do NOT answer it.

Decide three things:

1. needsHistory: true when the user refers to something from an earlier conversation: what they asked, discussed, shortlisted or were told before ("what did I ask on…", "last Tuesday I asked about…", "is your answer still correct", "those tools we picked"), or points back to something that is not in the recent turns shown. false for new questions, even on a topic they may have asked about before, and for small talk.

2. historyQuery: 2-6 keywords for finding that earlier conversation: product names, the subject ("postgres hosting pricing", "crm tools sales team"). Use an empty string when the user identifies it only by date ("what did I ask you on 3 November?").

3. dates: for EACH detected date mention (listed with an index and numbered readings):
   - {choice:"candidate", mention, reading, confidence}: pick the reading the user most likely means. Use the user's locale for numeric dates unless context says otherwise. confidence "high" only when context makes it clear.
   - {choice:"not_a_date", mention}: when it isn't a date in context (a version number, "May I…", a product name).
   For past-day phrases that were NOT detected ("the day we discussed CRMs", "the Monday after that", "the Tuesday before Diwali"), add {choice:"own", text, start, end?, weekday, confidence} with dates LOOKED UP in the calendar. Never compute weekdays yourself. Leave dates empty when there are none.`;

const defaultGenerate: GeneratePlan = async (system, prompt, signal) => {
  const { object } = await generateObject({
    model: anthropic(config.fastModel),
    schema: PlanSchema,
    system,
    prompt,
    abortSignal: signal,
  });
  return object;
};

export async function planTurn(input: PlanInput, generate: GeneratePlan = defaultGenerate): Promise<PlanResult> {
  const started = Date.now();
  try {
    const raw = await generate(SYSTEM, renderPlannerPrompt(input), AbortSignal.timeout(PLANNER_TIMEOUT_MS));
    return { plan: toPlan(raw), source: "planner", ms: Date.now() - started };
  } catch (error) {
    console.error("[planner] failed, using fallback:", (error as Error).message);
    // Safety net, not a second decider: look for history using the user's own words and chrono's dates.
    return {
      plan: { needsHistory: true, historyQuery: input.message, dates: null },
      source: "fallback",
      ms: Date.now() - started,
    };
  }
}

export function renderPlannerPrompt(input: PlanInput): string {
  const mentions = input.mentions.length
    ? input.mentions
        .map(
          (m, i) =>
            `${i}: "${m.text}" → ` + m.readings.map((r, j) => `reading ${j}: ${r.label}`).join(" | "),
        )
        .join("\n")
    : "(none)";
  const turns = input.recentTurns.length
    ? input.recentTurns
        .slice(-6)
        .map((t) => `${t.role}: ${t.content.replace(/\s+/g, " ").slice(0, 300)}`)
        .join("\n")
    : "(this is a new conversation)";

  return `Now: ${input.nowLabel}
User locale: ${input.locale} (writes numeric dates ${input.monthFirst ? "month-first" : "day-first"})

Calendar, last 6 weeks (Monday first):
${input.calendar}

Detected date mentions:
${mentions}

Recent turns in this conversation (oldest first):
${turns}

Latest user message:
${input.message}`;
}

/** Keep only well-formed date decisions; anything malformed is dropped and chrono's default applies. */
function toPlan(raw: RawPlan): Plan {
  const dates: PlannerDate[] = [];
  for (const d of raw.dates ?? []) {
    const confidence = d.confidence ?? "medium";
    if (d.choice === "candidate" && Number.isInteger(d.mention) && Number.isInteger(d.reading)) {
      dates.push({ choice: "candidate", mention: d.mention!, reading: d.reading!, confidence });
    } else if (d.choice === "not_a_date" && Number.isInteger(d.mention)) {
      dates.push({ choice: "not_a_date", mention: d.mention! });
    } else if (d.choice === "own" && d.text && d.start) {
      dates.push({ choice: "own", text: d.text, start: d.start, end: d.end, weekday: d.weekday, confidence });
    }
  }
  return { needsHistory: raw.needsHistory, historyQuery: raw.historyQuery.trim(), dates };
}
