"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchStep, type SearchPart } from "./SearchStep";

function newConversationId() {
  return `conv_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function Chat() {
  const [conversationId, setConversationId] = useState(newConversationId);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Send only the new message: the server loads the rest of the conversation from its database.
  // Timezone and locale let the server read "last Tuesday" or "3-10-26" the way this user means it.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages }) => {
          const last = messages[messages.length - 1];
          const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
          return { body: { conversationId: id, message: { text }, timeZone, locale } };
        },
      }),
    [],
  );
  const { messages, sendMessage, status, error, stop } = useChat({ id: conversationId, transport });
  const busy = status === "submitted" || status === "streaming";

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
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4">
      <header className="flex items-center justify-between py-4 text-sm">
        <span className="font-medium text-neutral-500">Minimi Chat</span>
        <button
          onClick={() => setConversationId(newConversationId())}
          disabled={busy}
          className="rounded-lg px-3 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
        >
          New chat
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto pb-6">
        {messages.length === 0 && (
          <p className="mt-24 text-center text-neutral-500">Ask me anything. I can search the web.</p>
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
                if (part.type === "tool-web_search") return <SearchStep key={i} part={part as SearchPart} />;
                return null;
              })}
            </div>
          </div>
        ))}
        {status === "submitted" && <p className="text-sm text-neutral-500">Thinking…</p>}
        {error && <p className="text-sm text-red-600">{error.message}</p>}
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
          <button type="button" onClick={stop} className="rounded-xl border px-4">
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
    </main>
  );
}
