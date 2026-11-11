"use client";

import type { UIMessage } from "ai";
import { useMemo, useState } from "react";
import type { MemoryStatus } from "@/agent/orchestrator";
import { timeLabel } from "@/lib/dates";
import { citedNumbers, searchesInParts, sourcesInParts } from "@/lib/parts";
import { Markdown } from "./Markdown";
import { MemoryStep } from "./MemoryStep";
import { SearchActivity } from "./SearchActivity";
import { Sources } from "./Sources";

export function createdAtOf(m: UIMessage): string | undefined {
  return (m.metadata as { createdAt?: string } | undefined)?.createdAt;
}

export function MessageView({
  message,
  stopped,
  streaming,
  timeZone,
}: {
  message: UIMessage;
  stopped: boolean;
  streaming: boolean; // this answer is still being written
  timeZone: string;
}) {
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n\n");
  const createdAt = createdAtOf(message);

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2 whitespace-pre-wrap dark:bg-neutral-800">{text}</div>
        {createdAt && <span className="mt-1 text-xs text-neutral-400">{timeLabel(createdAt, timeZone)}</span>}
      </div>
    );
  }
  return (
    <AssistantMessage
      message={message}
      text={text}
      stopped={stopped}
      streaming={streaming}
      createdAt={createdAt}
      timeZone={timeZone}
    />
  );
}

function AssistantMessage({
  message,
  text,
  stopped,
  streaming,
  createdAt,
  timeZone,
}: {
  message: UIMessage;
  text: string;
  stopped: boolean;
  streaming: boolean;
  createdAt?: string;
  timeZone: string;
}) {
  const [copied, setCopied] = useState(false);
  const sources = useMemo(() => new Map(sourcesInParts(message.parts).map((s) => [s.n, s])), [message.parts]);
  const cited = citedNumbers(text).flatMap((n) => sources.get(n) ?? []);
  const memory = message.parts.find((p) => p.type === "data-memory") as { data: MemoryStatus } | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); nothing useful to show.
    }
  }

  return (
    <div className="leading-relaxed">
      {memory && <MemoryStep status={memory.data} />}
      <SearchActivity searches={searchesInParts(message.parts)} />
      {text && <Markdown text={text} sources={sources} />}
      <Sources cited={cited} />
      <div className="mt-1 flex gap-3 text-xs text-neutral-400">
        {createdAt && <span>{timeLabel(createdAt, timeZone)}</span>}
        {stopped && <span>Stopped</span>}
        {text && !streaming && (
          <button onClick={copy} className="hover:text-neutral-600 dark:hover:text-neutral-200">
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
