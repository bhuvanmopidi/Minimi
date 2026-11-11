"use client";

export type ConversationSummary = { id: string; title: string; updatedAt: string };

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onLoadDemo,
  demoBusy,
}: {
  conversations: ConversationSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onLoadDemo: () => void;
  demoBusy: boolean;
}) {
  return (
    <nav className="flex h-full flex-col gap-2 p-3 text-sm">
      <button
        onClick={onNewChat}
        className="rounded-lg border border-neutral-300 px-3 py-2 text-left hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        + New chat
      </button>

      <div className="mt-2 flex-1 space-y-0.5 overflow-y-auto">
        {conversations.length === 0 && <p className="px-3 py-2 text-neutral-500">No past chats yet.</p>}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
              c.id === activeId ? "bg-neutral-100 dark:bg-neutral-800" : ""
            }`}
          >
            <span className="block truncate">{c.title}</span>
            <span className="block text-xs text-neutral-500">{dateFmt.format(new Date(c.updatedAt))}</span>
          </button>
        ))}
      </div>

      <button
        onClick={onLoadDemo}
        disabled={demoBusy}
        title="Adds a few labelled demo conversations dated earlier this month, to try questions like 'What did I ask you last Tuesday?'"
        className="rounded-lg px-3 py-2 text-left text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"
      >
        {demoBusy ? "Loading demo chats…" : "Load demo chats (for testing memory)"}
      </button>
    </nav>
  );
}
