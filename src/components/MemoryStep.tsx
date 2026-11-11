"use client";

import type { MemoryStatus } from "@/agent/orchestrator";

/** The "Checking your conversations from …" line. The server updates it in place when the check finishes. */
export function MemoryStep({ status }: { status: MemoryStatus }) {
  if (status.state === "searching") {
    return <p className="animate-pulse text-sm text-neutral-500">{status.label}…</p>;
  }
  const result =
    status.status === "found"
      ? `found ${status.found} conversation${status.found === 1 ? "" : "s"}`
      : status.status === "not_found"
        ? "nothing matching"
        : "nothing to look up";
  return (
    <p className="text-sm text-neutral-500">
      {status.label.replace(/^Checking/, "Checked")}: {result}
    </p>
  );
}
