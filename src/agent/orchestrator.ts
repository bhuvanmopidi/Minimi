import { anthropic } from "@ai-sdk/anthropic";
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from "ai";
import type Database from "better-sqlite3";
import { config } from "@/config";
import { newId } from "@/memory/ids";
import { getSummary, insertMessage, insertSearches, recentMessages, setTitleIfMissing } from "@/memory/repo";
import { findHistory, type HistoryResult } from "@/memory/retrieval";
import { buildCalendar } from "@/time/calendar";
import { findDateMentions, isMonthFirst } from "@/time/candidates";
import { describeNow, now } from "@/time/clock";
import { resolveDates, toUtcRange, type DateResolution } from "@/time/validate";
import { dayIn } from "@/time/zone";
import { createTavilyProvider } from "@/tools/tavily";
import { createWebSearchTool, runWebSearch, SourceRegistry, type SearchLogEntry, type Source } from "@/tools/webSearch";
import { recordClaimsInBackground } from "./claims";
import { renderContext } from "./context";
import { friendlyError } from "./errors";
import { toModelMessages } from "./history";
import { planTurn } from "./planner";
import { SYSTEM_PROMPT } from "./prompts";
import { buildPrefetch } from "./searchPlan";
import { updateSummaryInBackground } from "./summarize";

/** Shown in the UI while memory is checked; the same id is updated in place when the check finishes. */
export type MemoryStatus =
  | { state: "searching"; label: string }
  | { state: "done"; label: string; found: number; status: HistoryResult["status"] };

export type Turn = {
  db: Database.Database;
  conversationId: string;
  userId: string;
  text: string;
  timeZone: string;
  locale: string;
  /** Aborts when the user presses Stop or closes the tab (the request's signal). */
  signal: AbortSignal;
};

/** One user turn, end to end (docs/architecture.md). The user message is already saved. */
export function runTurn(turn: Turn): Response {
  const { db, conversationId, timeZone } = turn;
  const startedAt = now();
  const assistantId = newId("msg");
  const registry = new SourceRegistry();
  const searchLog: SearchLogEntry[] = [];
  // Stop really stops: the model and any searches are cancelled, and the partial answer is saved.
  // A hard per-turn limit catches anything that runs away.
  const signal = AbortSignal.any([turn.signal, AbortSignal.timeout(config.turnTimeoutMs)]);
  // One set of search dependencies per turn: prefetch and the model's own tool calls share citation
  // numbers ([n] stays unique across both) and the snapshots saved with the answer.
  const searchDeps = {
    db,
    provider: createTavilyProvider(config.tavilyApiKey),
    registry,
    searchLog,
    now,
    abortSignal: signal,
  };

  const stream = createUIMessageStream({
    generateId: () => assistantId,
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: assistantId });

      // ④ recent turns (includes the just-saved user message as the last entry)
      const recent = recentMessages(db, conversationId, config.recentTurnLimit);

      // ⑤ code proposes date readings
      const today = dayIn(startedAt, timeZone);
      const mentions = findDateMentions(turn.text, { today, locale: turn.locale });

      // ⑥ one planner call decides history + date meanings
      const { plan, source, ms: planMs } = await planTurn({
        message: turn.text,
        recentTurns: recent.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        nowLabel: describeNow(startedAt, timeZone),
        locale: turn.locale,
        monthFirst: isMonthFirst(turn.locale),
        calendar: buildCalendar(today),
        mentions,
      });

      if (plan.title && recent.length === 1) setTitleIfMissing(db, conversationId, plan.title);

      // ⑦ code validates the planner's date decisions
      const dates = resolveDates(mentions, plan.dates, { today });

      // ⑧ history lookup across all of this user's conversations
      let history: HistoryResult | null = null;
      if (plan.needsHistory) {
        const label = memoryLabel(dates);
        writer.write({ type: "data-memory", id: "memory", data: { state: "searching", label } satisfies MemoryStatus });
        history = findHistory(db, {
          userId: turn.userId,
          topic: plan.historyQuery,
          windows: dates.resolved.map((d) => ({ label: d.primary.label, ...toUtcRange(d.primary, timeZone) })),
          alternativeWindows: dates.resolved.flatMap((d) =>
            d.alternative ? [{ label: d.alternative.label, ...toUtcRange(d.alternative, timeZone) }] : [],
          ),
          excludeMessageIds: recent.map((m) => m.id),
        });
        const found = history.status === "found" ? history.conversations.length : 0;
        writer.write({
          type: "data-memory",
          id: "memory",
          data: { state: "done", label, found, status: history.status } satisfies MemoryStatus,
        });
      }

      // ⑧b searches start before the answer: the planner's, plus one per recorded fact on a re-check.
      //     Shown live like tool calls; they share the turn's citation numbers and cache.
      const batches = buildPrefetch(plan, history);
      let search: { sources: Source[]; errors: string[]; fetchedAt: string } | null = null;
      const searchStarted = Date.now();
      if (batches.length) {
        batches.forEach((input, i) =>
          writer.write({ type: "data-search", id: `prefetch-${i}`, data: { state: "input-available", input } }),
        );
        const outputs = await Promise.all(batches.map((input) => runWebSearch(input, searchDeps)));
        outputs.forEach((output, i) =>
          writer.write({
            type: "data-search",
            id: `prefetch-${i}`,
            data: { state: "output-available", input: batches[i], output },
          }),
        );
        const sources = new Map<number, Source>();
        const errors: string[] = [];
        for (const out of outputs) {
          if ("error" in out) errors.push(out.error);
          else out.results.forEach((r) => sources.set(r.n, r));
        }
        search = { sources: [...sources.values()].sort((a, b) => a.n - b.n), errors, fetchedAt: now().toISOString() };
      }

      if (signal.aborted) return; // stopped while planning or searching: nothing to answer

      // ⑨ context block, attached to the latest user message for the model only
      const context = renderContext({
        nowLabel: describeNow(startedAt, timeZone),
        summary: getSummary(db, conversationId).summary,
        intent: plan.intent,
        dates,
        history,
        historyFromFallback: source === "fallback",
        search,
        timeZone,
      });
      const messages = toModelMessages(recent, context);

      // ⑩ the answer: Sonnet with web_search as its one tool
      const prefetchMs = Date.now() - searchStarted;
      const answerStarted = Date.now();
      let firstTokenMs: number | null = null;
      const stepLog: string[] = [];
      const result = streamText({
        model: anthropic(config.mainModel),
        messages: [
          // Cache breakpoint after the static system prompt: tools + system are reused across turns.
          { role: "system", content: SYSTEM_PROMPT, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
          ...messages,
        ],
        tools: { web_search: createWebSearchTool(searchDeps) },
        providerOptions: { anthropic: { effort: config.mainEffort } },
        stopWhen: stepCountIs(config.maxSteps),
        maxRetries: 2, // overloaded / rate-limited: retried with backoff before the user sees an error
        abortSignal: signal,
        onChunk: ({ chunk }) => {
          if (chunk.type === "text-delta" && firstTokenMs === null) firstTokenMs = Date.now() - answerStarted;
        },
        onStepFinish: (step) => {
          const calls = step.toolCalls.map((c) => JSON.stringify(c.input)).join(" ");
          stepLog.push(`${Date.now() - answerStarted}ms${calls ? ` tool:${calls}` : ""}`);
        },
        onFinish: ({ steps, totalUsage, providerMetadata }) => {
          // One line per turn, so latency and caching regressions are visible in the server log.
          const written = (providerMetadata?.anthropic as { cacheCreationInputTokens?: number } | undefined)
            ?.cacheCreationInputTokens;
          console.log(
            `[turn] intent=${plan.intent} planner=${planMs}ms(${source}) prefetch=${batches.length ? `${prefetchMs}ms/${batches.reduce((n, b) => n + b.queries.length, 0)}q` : "-"} ` +
              `context=${context.length}ch first_token=${firstTokenMs}ms answer=${Date.now() - answerStarted}ms steps=${steps.length} ` +
              `tokens_in=${totalUsage.inputTokens} cache_read=${totalUsage.cachedInputTokens ?? 0} cache_write=${written ?? 0} [${stepLog.join(" | ")}]`,
          );
        },
      });
      writer.merge(result.toUIMessageStream({ sendStart: false }));
    },
    // ⑫ save the answer (with its parts, so a reopened chat renders the same) and its searches
    onFinish: ({ responseMessage, isAborted }) => {
      const text = responseMessage.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (!text) return;
      const savedAt = now().toISOString();
      db.transaction(() => {
        insertMessage(db, {
          id: assistantId,
          conversationId,
          role: "assistant",
          content: text,
          partsJson: JSON.stringify(responseMessage.parts),
          aborted: isAborted,
          at: savedAt,
        });
        insertSearches(db, assistantId, searchLog);
      })();
      // ⑬ background work: the user already has the answer.
      if (!isAborted) recordClaimsInBackground(db, assistantId, text, registry.list(), savedAt);
      updateSummaryInBackground(db, conversationId);
    },
    onError: (error) => {
      console.error("[chat] stream error", error);
      return friendlyError(error);
    },
  });

  // Keep reading the stream even if the browser disconnects, so onFinish always runs.
  return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream });
}

function memoryLabel(dates: DateResolution): string {
  const d = dates.resolved[0];
  if (!d) return "Checking your past conversations";
  return d.alternative
    ? `Checking your conversations from ${d.primary.label} (or ${d.alternative.label})`
    : `Checking your conversations from ${d.primary.label}`;
}
