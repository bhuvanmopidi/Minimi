import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type Database from "better-sqlite3";
import { config } from "@/config";
import { allMessages, getSummary, saveSummary, type MessageRow } from "@/memory/repo";

// Rolling summary for long conversations (Phase 4). The model reads the summary plus the last
// `recentTurnLimit` messages, so a 100-message chat costs about as much as a 20-message one.
// Runs in the background after an answer is saved; the user never waits for it.

const SUMMARY_TIMEOUT_MS = 20_000;
const MAX_MESSAGE_CHARS = 1_500;

export type Summarize = (prompt: string, signal: AbortSignal) => Promise<string>;

const SYSTEM = `You maintain a running summary of a chat between a user and an assistant, so the assistant can keep the thread after older messages are dropped from its view.
Keep: what the user is trying to do, their constraints and preferences, decisions made, key facts and figures given (with their dates), and open questions.
Drop: pleasantries and anything superseded. Write at most 250 words, as plain sentences or short bullets.`;

const defaultSummarize: Summarize = async (prompt, signal) => {
  const { text } = await generateText({ model: anthropic(config.fastModel), system: SYSTEM, prompt, abortSignal: signal });
  return text.trim();
};

/**
 * Messages that are no longer in the model's window. A little slack (2 messages) is kept so the
 * next turn's window (which adds the new question) never leaves a gap between summary and window.
 */
export function messagesOutsideWindow(rows: MessageRow[], windowSize: number): MessageRow[] {
  return rows.slice(0, Math.max(0, rows.length - (windowSize - 2)));
}

/** Update the summary if messages have dropped out of the window since it was last written. */
export async function updateSummary(
  db: Database.Database,
  conversationId: string,
  summarize: Summarize = defaultSummarize,
): Promise<boolean> {
  const rows = allMessages(db, conversationId);
  if (rows.length <= config.recentTurnLimit) return false;

  const outside = messagesOutsideWindow(rows, config.recentTurnLimit);
  const { summary, through } = getSummary(db, conversationId);
  const fresh = outside.filter((m) => !through || m.created_at > through);
  if (!fresh.length) return false;

  const transcript = fresh
    .map((m) => `${m.role}: ${m.content.length > MAX_MESSAGE_CHARS ? `${m.content.slice(0, MAX_MESSAGE_CHARS)} …` : m.content}`)
    .join("\n\n");
  const prompt = `${summary ? `Summary so far:\n${summary}\n\n` : ""}New messages to fold in:\n${transcript}\n\nWrite the updated summary.`;

  const next = await summarize(prompt, AbortSignal.timeout(SUMMARY_TIMEOUT_MS));
  if (next) saveSummary(db, conversationId, next, outside[outside.length - 1].created_at);
  return Boolean(next);
}

export function updateSummaryInBackground(db: Database.Database, conversationId: string): void {
  updateSummary(db, conversationId).catch((error) =>
    console.error("[summary] update failed:", (error as Error).message),
  );
}
