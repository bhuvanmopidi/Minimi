"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryStatus } from "@/agent/orchestrator";
import { MemoryStep } from "./MemoryStep";
import { SearchStep, type SearchPart } from "./SearchStep";

/** One conversation. Re-mounted (via `key`) when the user switches chats. */
export function ChatView({
  conversationId,
  initialMessages,
  onTurnFinished,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
  onTurnFinished: () => void;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Send only the new message: the server loads the rest of the conversation from its database.
  // Timezone and locale let the server read "last Tuesday" or "3-10-26" the way this user means it.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages, trigger }) => {
          const last = messages[messages.length - 1];
          const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
          // Retry re-answers the stored question instead of saving it a second time.
          const retry = trigger === "regenerate-message";
          return { body: { conversationId: id, message: { text }, timeZone, locale, retry } };
        },
      }),
    [],
  );
  const { messages, sendMessage, regenerate, status, error, stop } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onFinish: onTurnFinished,
  });
  const busy = status === "submitted" || status === "streaming";
  // Answers cut off by Stop: from this session, or marked `aborted` when a saved chat is reopened.
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(
    () => new Set(initialMessages.filter((m) => (m.metadata as { aborted?: boolean } | undefined)?.aborted).map((m) => m.id)),
  );

  function stopAnswer() {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") setStoppedIds((s) => new Set(s).add(last.id));
    void stop();
  }

  const last = messages[messages.length - 1];
  const canRetry = !busy && (error || (last?.role === "assistant" && stoppedIds.has(last.id)) || last?.role === "user");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto pb-6">
        {messages.length === 0 && (
          <div className="mt-24 space-y-2 text-center text-neutral-500">
            <p>Ask me anything. I can search the web and I remember our past chats.</p>
            <p className="text-sm">Try: &ldquo;What did I ask you last week?&rdquo;</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-2 dark:bg-neutral-800"
                  : "leading-relaxed"
              }
            >
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <p key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                }
                if (part.type === "data-memory") return <MemoryStep key={i} status={part.data as MemoryStatus} />;
                if (part.type === "tool-web_search") return <SearchStep key={i} part={part as SearchPart} />;
                // Searches the server ran before the answer started (same shape as a tool call).
                if (part.type === "data-search") return <SearchStep key={i} part={part.data as SearchPart} />;
                return null;
              })}
              {stoppedIds.has(m.id) && <p className="mt-1 text-xs text-neutral-500">Stopped</p>}
            </div>
          </div>
        ))}
        {status === "submitted" && <p className="text-sm text-neutral-500">Thinking…</p>}
        {error && <p className="text-sm text-red-600">{error.message}</p>}
        {canRetry && messages.length > 0 && (
          <button
            onClick={() => void regenerate()}
            className="rounded-lg border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            ↻ Retry
          </button>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex gap-2 pb-6">
        <input
          className="flex-1 rounded-xl border border-neutral-300 bg-transparent px-4 py-3 outline-none focus:border-neutral-500 dark:border-neutral-700"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message Minimi…"
          autoFocus
        />
        {busy ? (
          <button type="button" onClick={stopAnswer} className="rounded-xl border px-4">
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-xl bg-neutral-900 px-4 text-white dark:bg-white dark:text-neutral-900"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
