import { cookies } from "next/headers";
import { newId } from "./ids";

const USER_COOKIE = "minimi_uid";

/**
 * Anonymous per-browser identity (ADR-0009). With `create`, a first-time visitor gets a new id
 * and an httpOnly cookie; without it, a visitor with no cookie has no history (returns null).
 */
export async function userIdFromCookies(opts: { create: true }): Promise<string>;
export async function userIdFromCookies(opts?: { create?: false }): Promise<string | null>;
export async function userIdFromCookies(opts?: { create?: boolean }): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(USER_COOKIE)?.value;
  if (existing && /^usr_[a-z0-9]{16}$/.test(existing)) return existing;
  if (!opts?.create) return null;
  const userId = newId("usr");
  jar.set(USER_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return userId;
}
