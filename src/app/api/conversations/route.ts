import { getDb } from "@/memory/db";
import { listConversations } from "@/memory/repo";
import { userIdFromCookies } from "@/memory/user";

export const runtime = "nodejs";

/** Sidebar: this browser's conversations, most recent first. */
export async function GET() {
  const userId = await userIdFromCookies();
  return Response.json({ conversations: userId ? listConversations(getDb(), userId) : [] });
}
