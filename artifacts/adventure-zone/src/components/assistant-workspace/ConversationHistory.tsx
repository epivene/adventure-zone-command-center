import type {
  ConversationLifecycle,
  ConversationListItem,
} from "@/features/assistant-workspace/types";

export function ConversationHistory({
  items,
  view,
  selectedId,
  busy,
  loading,
  button,
  onView,
  onOpen,
  onCreate,
  onMove,
}: {
  items: ConversationListItem[];
  view: ConversationLifecycle;
  selectedId?: string;
  busy: boolean;
  loading: boolean;
  button: string;
  onView: (view: ConversationLifecycle) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onMove: (
    item: ConversationListItem,
    lifecycle: ConversationLifecycle,
  ) => void;
}) {
  return (
    <aside className="min-w-0 rounded-xl border bg-white p-3">
      <button
        type="button"
        className={`${button} w-full`}
        onClick={onCreate}
        disabled={busy}
      >
        New conversation
      </button>
      <label className="mt-3 block text-sm font-medium">
        Conversation history
        <select
          className="mt-1 min-h-11 w-full rounded-lg border bg-white px-2 text-base"
          value={view}
          onChange={(e) => onView(e.target.value as ConversationLifecycle)}
          disabled={busy}
        >
          <option value="active">Recent</option>
          <option value="archived">Archived</option>
          <option value="trashed">Trash</option>
        </select>
      </label>
      <p className="mt-2 text-xs text-slate-500">
        {view === "trashed"
          ? "Moved out of your history. Restore to continue; nothing is permanently deleted."
          : view === "archived"
            ? "Saved for later. Restore to continue."
            : "Chats are saved automatically."}
      </p>
      <nav
        aria-label="Saved conversations"
        aria-busy={loading}
        className="mt-3 flex max-h-[65dvh] flex-col gap-2 overflow-auto"
      >
        {loading ? (
          <p role="status" className="p-2 text-sm">
            Loading conversations…
          </p>
        ) : !items.length ? (
          <p className="p-2 text-sm text-slate-500">No conversations here.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={`min-w-0 rounded-lg border ${selectedId === item.id ? "border-teal-200 bg-teal-50" : "border-transparent"}`}
            >
              <a
                href={`/assistant/workspace/${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (!busy) onOpen(item.id);
                }}
                aria-current={selectedId === item.id ? "page" : undefined}
                aria-disabled={busy}
                className="block min-h-11 break-words p-3 text-sm font-medium"
              >
                {item.title}
              </a>
              <div className="flex flex-wrap gap-1 px-2 pb-2">
                {view === "active" ? (
                  <button
                    className="min-h-11 rounded px-2 text-xs hover:bg-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => onMove(item, "archived")}
                    aria-label={`Archive ${item.title}`}
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    className="min-h-11 rounded px-2 text-xs hover:bg-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => onMove(item, "active")}
                    aria-label={`Restore ${item.title}`}
                  >
                    Restore
                  </button>
                )}
                {view !== "trashed" && (
                  <button
                    className="min-h-11 rounded px-2 text-xs text-red-800 hover:bg-white disabled:opacity-50"
                    disabled={busy}
                    onClick={() => onMove(item, "trashed")}
                    aria-label={`Move ${item.title} to trash`}
                  >
                    Trash
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}
