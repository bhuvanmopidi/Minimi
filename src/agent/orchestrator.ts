import { anthropic } from "@ai-sdk/anthropic";
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type ModelMessage,
} from "ai";
import type Database from "better-sqlite3";
import { config } from "@/config";
import { newId } from "@/memory/ids";
import { insertMessage, insertSearches, recentMessages } from "@/memory/repo";
import { findHistory, type HistoryResult } from "@/memory/retrieval";
import { buildCalendar } from "@/time/calendar";
import { findDateMentions, isMonthFirst } from "@/time/candidates";
import { describeNow, now } from "@/time/clock";
import { resolveDates, toUtcRange, type DateResolution } from "@/time/validate";
import { dayIn } from "@/time/zone";
import { createTavilyProvider } from "@/tools/tavily";
import { createWebSearchTool, SourceRegistry, type SearchLogEntry } from "@/tools/webSearch";
import { renderContext } from "./context";
import { planTurn } from "./planner";
import { buildSystemPrompt } from "./prompts";

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
};

/** One user turn, end to end (docs/architecture.md). The user message is already saved. */
export function runTurn(turn: Turn): Response {
  const { db, conversationId, timeZone } = turn;
  const startedAt = now();
  const assistantId = newId("msg");
  const registry = new SourceRegistry();
  const searchLog: SearchLogEntry[] = [];

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
      const { plan, source } = await planTurn({
        message: turn.text,
        recentTurns: recent.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        nowLabel: describeNow(startedAt, timeZone),
        locale: turn.locale,
        monthFirst: isMonthFirst(turn.locale),
        calendar: buildCalendar(today),
        mentions,
      });

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

      // ⑨ context block, attached to the latest user message for the model only
      const context = renderContext({ dates, history, historyFromFallback: source === "fallback", timeZone });
      const messages: ModelMessage[] = recent.map((m, i) => ({
        role: m.role,
        content: i === recent.length - 1 && context ? `${context}\n\n${m.content}` : m.content,
      }));

      // ⑩ the answer: Sonnet with web_search as its one tool
      const result = streamText({
        model: anthropic(config.mainModel),
        system: buildSystemPrompt({ now: startedAt, timeZone }),
        messages,
        tools: {
          web_search: createWebSearchTool({
            db,
            provider: createTavilyProvider(config.tavilyApiKey),
            registry,
            searchLog,
            now,
          }),
        },
        stopWhen: stepCountIs(config.maxSteps),
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
      db.transaction(() => {
        insertMessage(db, {
          id: assistantId,
          conversationId,
          role: "assistant",
          content: text,
          partsJson: JSON.stringify(responseMessage.parts),
          aborted: isAborted,
          at: now().toISOString(),
        });
        insertSearches(db, assistantId, searchLog);
      })();
    },
    onError: (error) => {
      console.error("[chat] stream error", error);
      return "Something went wrong while generating the answer. Please try again.";
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
