"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { dividerLabel, startsNewDay } from "@/lib/dates";
import { createdAtOf, MessageView } from "./MessageView";

const EXAMPLES = [
  "What's new in the latest Node.js release?",
  "Compare Neon, Supabase and Railway pricing for a small SaaS",
  "What did I ask you last Tuesday?",
  "On Monday we shortlisted 5 CRM tools. Has any of them changed pricing since?",
];

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

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

  // Follow the stream only while the reader is at the bottom; never yank them back up mid-read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    atBottom.current = true;
    sendMessage({ text: t, metadata: { createdAt: new Date().toISOString() } });
    setInput("");
  }

  function stopAnswer() {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") setStoppedIds((s) => new Set(s).add(last.id));
    void stop();
  }

  const last = messages[messages.length - 1];
  const canRetry = !busy && (error || (last?.role === "assistant" && stoppedIds.has(last.id)) || last?.role === "user");
  const now = new Date();

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-6 overflow-y-auto pb-6">
        {messages.length === 0 && (
          <div className="mx-auto mt-16 max-w-xl space-y-4 text-center">
            <p className="text-lg">What can I look up for you?</p>
            <p className="text-sm text-neutral-500">
              I search the web and remember our past chats. To try memory on a fresh install, click &ldquo;Load demo
              chats&rdquo; in the sidebar.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const at = createdAtOf(m);
          const prevAt = messages.slice(0, i).map(createdAtOf).filter(Boolean).pop();
          return (
            <Fragment key={m.id}>
              {at && startsNewDay(prevAt, at, timeZone) && (
                <div className="flex items-center gap-3 text-xs text-neutral-400">
                  <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                  {dividerLabel(at, now, timeZone)}
                  <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
                </div>
              )}
              <MessageView
                message={m}
                stopped={stoppedIds.has(m.id)}
                streaming={busy && i === messages.length - 1}
                timeZone={timeZone}
              />
            </Fragment>
          );
        })}
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
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 pb-6"
      >
        <textarea
          className="max-h-48 min-h-12 flex-1 resize-none rounded-xl border border-neutral-300 bg-transparent px-4 py-3 outline-none [field-sizing:content] focus:border-neutral-500 dark:border-neutral-700"
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line; never send mid-IME composition (e.g. Japanese input).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Message Minimi…  (Shift+Enter for a new line)"
          autoFocus
        />
        {busy ? (
          <button type="button" onClick={stopAnswer} className="h-12 rounded-xl border px-4">
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="h-12 rounded-xl bg-neutral-900 px-4 text-white dark:bg-white dark:text-neutral-900"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
