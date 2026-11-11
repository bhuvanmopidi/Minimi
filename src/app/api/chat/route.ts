import { anthropic } from "@ai-sdk/anthropic";
import { consumeStream, streamText, type ModelMessage } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";
import { config, requireEnv } from "@/config";
import { buildSystemPrompt } from "@/agent/prompts";
import { getDb } from "@/memory/db";
import { newId } from "@/memory/ids";
import { getOrCreateConversation, insertMessage, recentMessages } from "@/memory/repo";
import { isValidTimeZone, now } from "@/time/clock";

export const runtime = "nodejs";
export const maxDuration = 60;

const USER_COOKIE = "minimi_uid";

// The client sends only the new message; the server owns the conversation history.
const ChatRequest = z.object({
  conversationId: z.string().regex(/^conv_[A-Za-z0-9]{8,32}$/),
  message: z.object({ text: z.string().trim().min(1).max(8000) }),
  timeZone: z.string().optional(),
  locale: z.string().optional(), // read by the date parser from Phase 2 (day-first vs month-first)
});

export async function POST(req: Request) {
  try {
    requireEnv("ANTHROPIC_API_KEY");
  } catch (error) {
    // useChat surfaces the response body as the error message, so make it human-readable.
    return new Response((error as Error).message, { status: 500 });
  }

  const parsed = ChatRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request.", { status: 400 });
  const { conversationId, message } = parsed.data;
  const timeZone = isValidTimeZone(parsed.data.timeZone) ? parsed.data.timeZone : "UTC";

  // Anonymous identity: one id per browser, set on first visit.
  const jar = await cookies();
  let userId = jar.get(USER_COOKIE)?.value;
  if (!userId) {
    userId = newId("usr");
    jar.set(USER_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }

  const db = getDb();
  const startedAt = now();
  const conversation = getOrCreateConversation(db, { id: conversationId, userId, at: startedAt.toISOString() });
  if (!conversation) return new Response("Conversation not found.", { status: 404 });

  // Save the user's message before any model work, so it survives a failed generation.
  insertMessage(db, {
    id: newId("msg"),
    conversationId,
    role: "user",
    content: message.text,
    tz: timeZone,
    at: startedAt.toISOString(),
  });

  const history: ModelMessage[] = recentMessages(db, conversationId, config.recentTurnLimit).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result = streamText({
    model: anthropic(config.mainModel),
    system: buildSystemPrompt({ now: startedAt, timeZone }),
    messages: history,
  });

  const assistantId = newId("msg");
  return result.toUIMessageStreamResponse({
    generateMessageId: () => assistantId,
    // Keep reading the model stream even if the browser disconnects, so onFinish always runs.
    consumeSseStream: consumeStream,
    onFinish: ({ responseMessage, isAborted }) => {
      const text = responseMessage.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
      if (!text) return;
      insertMessage(db, {
        id: assistantId,
        conversationId,
        role: "assistant",
        content: text,
        partsJson: JSON.stringify(responseMessage.parts),
        aborted: isAborted,
        at: now().toISOString(),
      });
    },
    onError: (error) => {
      console.error("[chat] stream error", error);
      return "Something went wrong while generating the answer. Please try again.";
    },
  });
}
