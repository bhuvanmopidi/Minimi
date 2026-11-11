import { z } from "zod";
import { getDb } from "@/memory/db";
import { seedDemoHistory } from "@/memory/demo";
import { userIdFromCookies } from "@/memory/user";
import { isValidTimeZone, now } from "@/time/clock";

export const runtime = "nodejs";

/** "Load demo chats": creates labelled demo conversations for THIS browser, dated relative to today. */
export async function POST(req: Request) {
  const body = z.object({ timeZone: z.string().optional() }).safeParse(await req.json().catch(() => ({})));
  const tz = body.success && isValidTimeZone(body.data.timeZone) ? body.data.timeZone : "UTC";
  const userId = await userIdFromCookies({ create: true });
  const created = seedDemoHistory(getDb(), { userId, timeZone: tz, now: now() });
  return Response.json({ created });
}
