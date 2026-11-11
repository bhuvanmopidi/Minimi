import { getDb } from "@/memory/db";
import { conversationMessages } from "@/memory/repo";
import { userIdFromCookies } from "@/memory/user";

export const runtime = "nodejs";

/** Reopen a conversation: its messages as UI messages (answers keep their sources via parts_json). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await userIdFromCookies();
  const rows = userId ? conversationMessages(getDb(), id, userId) : null;
  if (!rows) return new Response("Conversation not found.", { status: 404 });

  const messages = rows.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts_json ? JSON.parse(m.parts_json) : [{ type: "text", text: m.content }],
    metadata: { createdAt: m.created_at, aborted: m.aborted === 1 },
  }));
  return Response.json({ messages });
}
