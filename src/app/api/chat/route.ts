import { z } from "zod";
import { requireEnv } from "@/config";
import { runTurn } from "@/agent/orchestrator";
import { getDb } from "@/memory/db";
import { newId } from "@/memory/ids";
import { getOrCreateConversation, insertMessage } from "@/memory/repo";
import { userIdFromCookies } from "@/memory/user";
import { isValidLocale, isValidTimeZone, now } from "@/time/clock";

export const runtime = "nodejs";
export const maxDuration = 60;

// The client sends only the new message; the server owns the conversation history (ADR-0007).
const ChatRequest = z.object({
  conversationId: z.string().regex(/^conv_[A-Za-z0-9]{8,32}$/),
  message: z.object({ text: z.string().trim().min(1).max(8000) }),
  timeZone: z.string().optional(),
  locale: z.string().optional(),
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
  const locale = isValidLocale(parsed.data.locale) ? parsed.data.locale : "en-US";

  const userId = await userIdFromCookies({ create: true });
  const db = getDb();
  const at = now().toISOString();
  const conversation = getOrCreateConversation(db, { id: conversationId, userId, at });
  if (!conversation) return new Response("Conversation not found.", { status: 404 });

  // Save the user's message before any model work, so it survives a failed generation.
  insertMessage(db, { id: newId("msg"), conversationId, role: "user", content: message.text, tz: timeZone, at });

  return runTurn({ db, conversationId, userId, text: message.text, timeZone, locale });
}
