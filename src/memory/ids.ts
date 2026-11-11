import { randomUUID } from "node:crypto";

// Prefixed ids make rows and logs readable at a glance (conv_…, msg_…, usr_…).
export function newId(prefix: "usr" | "conv" | "msg" | "srch" | "clm"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
