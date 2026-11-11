"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useState } from "react";
import { ChatView } from "./ChatView";
import { Sidebar, type ConversationSummary } from "./Sidebar";

function newConversationId() {
  return `conv_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Sidebar of past conversations + the active chat. */
export function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<{ id: string; messages: UIMessage[] }>(() => ({
    id: newConversationId(),
    messages: [],
  }));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(((await res.json()) as { conversations: ConversationSummary[] }).conversations);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function open(id: string) {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const { messages } = (await res.json()) as { messages: UIMessage[] };
    setActive({ id, messages });
    setSidebarOpen(false);
  }

  async function loadDemo() {
    setDemoBusy(true);
    try {
      await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      await refresh();
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div className="flex h-dvh">
      <aside
        className={`${sidebarOpen ? "fixed inset-0 z-10 bg-white dark:bg-neutral-950" : "hidden"} w-full border-r border-neutral-200 md:static md:block md:w-64 dark:border-neutral-800`}
      >
        <Sidebar
          conversations={conversations}
          activeId={active.id}
          onSelect={open}
          onNewChat={() => {
            setActive({ id: newConversationId(), messages: [] });
            setSidebarOpen(false);
          }}
          onLoadDemo={loadDemo}
          demoBusy={demoBusy}
        />
      </aside>

      <main className="mx-auto flex min-w-0 max-w-3xl flex-1 flex-col px-4">
        <header className="flex items-center justify-between py-4 text-sm">
          <button onClick={() => setSidebarOpen(true)} className="text-neutral-500 md:hidden">
            ☰ Chats
          </button>
          <span className="font-medium text-neutral-500">Minimi Chat</span>
          <span className="w-12 md:hidden" />
        </header>
        <div className="min-h-0 flex-1">
          <ChatView
            key={active.id}
            conversationId={active.id}
            initialMessages={active.messages}
            onTurnFinished={refresh}
          />
        </div>
      </main>
    </div>
  );
}
