import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { config } from "@/config";
import type { DateMention } from "@/time/candidates";
import type { PlannerDate } from "@/time/validate";

// Plan-then-execute (ADR-0002): ONE fast structured call that decides, and calls nothing:
// the kind of turn, whether it needs past conversations, what to search, what the dates mean, a title.

const PLANNER_TIMEOUT_MS = 6_000;

export type Intent = "new_question" | "follow_up" | "recall" | "recheck" | "chit_chat";
export type PlannedSearch = { query: string; since?: string; topic: "general" | "news" };

export type Plan = {
  intent: Intent;
  needsHistory: boolean;
  historyQuery: string;
  searches: PlannedSearch[];
  dates: PlannerDate[] | null;
  title?: string;
};
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
  intent: z.enum(["new_question", "follow_up", "recall", "recheck", "chit_chat"]),
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
  searches: z
    .array(
      z.object({
        query: z.string(),
        since: z.string().optional().describe("YYYY-MM-DD: only results published on/after this date"),
        topic: z.enum(["general", "news"]).optional(),
      }),
    )
    .describe("0-4 web searches to run before answering; empty if no web lookup is needed"),
  title: z.string().optional().describe("ONLY for the first message of a new conversation: a 3-6 word title"),
});

type RawPlan = z.infer<typeof PlanSchema>;
export type GeneratePlan = (system: string, prompt: string, signal: AbortSignal) => Promise<RawPlan>;

const SYSTEM = `You plan how a chat assistant with memory and web search should handle the user's latest message. You do NOT answer it.

0. intent: "recall" = ONLY asks what was said before; "recheck" = asks whether an earlier answer is still true/correct/current, or what changed since. If the message does both ("What did I ask on 3 Nov? Is it still correct?"), it is "recheck". "follow_up" = continues the current conversation; "new_question"; "chit_chat".

1. needsHistory: true when the user refers to something from an earlier conversation: what they asked, discussed, shortlisted or were told before ("what did I ask on…", "last Tuesday I asked about…", "is your answer still correct", "those tools we picked"), or points back to something that is not in the recent turns shown. false for new questions, even on a topic they may have asked about before, and for small talk.

2. historyQuery: 2-6 keywords for finding that earlier conversation: product names, the subject ("postgres hosting pricing", "crm tools sales team"). Use an empty string when the user identifies it only by date ("what did I ask you on 3 November?").

3. dates: for EACH detected date mention (listed with an index and numbered readings):
   - {choice:"candidate", mention, reading, confidence}: pick the reading the user most likely means. Use the user's locale for numeric dates unless context says otherwise. confidence "high" only when context makes it clear.
   - {choice:"not_a_date", mention}: when it isn't a date in context (a version number, "May I…", a product name).
   For past-day phrases that were NOT detected ("the day we discussed CRMs", "the Monday after that", "the Tuesday before Diwali"), add {choice:"own", text, start, end?, weekday, confidence} with dates LOOKED UP in the calendar. Never compute weekdays yourself. Leave dates empty when there are none.

4. searches: up to 4 web searches that answering will need, run in parallel before the answer starts. Search for anything time-sensitive (prices, plans, releases, news, current facts). Make each query specific and self-contained (resolve "it"/"those" using the recent turns). One query per product when comparing. For "what's new / shipped since <date>", use topic "news" with since = that date. For current prices or plans, use topic "general" WITHOUT since (pricing pages often have no publish date). Empty for small talk, recall-only questions, writing help and stable knowledge. For a recheck, ALWAYS add 1-2 general searches about the topic's recent changes (e.g. {query: "CRM software pricing changes", topic: "news", since: <that date>}), because the earlier conversation may not exist; don't guess its specific items: the system adds one search per fact it recorded.

5. title: only when there are no recent turns (a new conversation): 3-6 words naming the topic. Otherwise omit.`;

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
    // Searches are left to the main model, which still has the web_search tool.
    return {
      plan: { intent: "new_question", needsHistory: true, historyQuery: input.message, searches: [], dates: null },
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
  const searches: PlannedSearch[] = (raw.searches ?? [])
    .filter((s) => s.query.trim().length >= 2)
    .slice(0, 4)
    .map((s) => ({
      query: s.query.trim(),
      since: s.since && /^\d{4}-\d{2}-\d{2}$/.test(s.since) ? s.since : undefined,
      topic: s.topic ?? "general",
    }));
  const title = raw.title?.trim().replace(/^["']|["']$/g, "").slice(0, 80) || undefined;
  return { intent: raw.intent, needsHistory: raw.needsHistory, historyQuery: raw.historyQuery.trim(), searches, dates, title };
}
