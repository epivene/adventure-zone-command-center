import { ChevronLeft, ChevronRight } from "lucide-react";

import type { PaperNoteEntrySummary } from "@/features/paper-notes/paper-note-types";

function stateLabel(state: PaperNoteEntrySummary["state"]) {
  return state.replaceAll("_", " ");
}

export function PaperNoteEntryNavigator({
  entries,
  selectedId,
  onSelect,
}: {
  entries: PaperNoteEntrySummary[];
  selectedId: string;
  onSelect(entryId: string): void;
}) {
  const index = Math.max(0, entries.findIndex((entry) => entry.id === selectedId));
  const selected = entries[index];
  const previous = index > 0 ? entries[index - 1] : null;
  const next = index < entries.length - 1 ? entries[index + 1] : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <button
          aria-label="Previous paper entry"
          className="min-h-11 min-w-11 rounded-lg border border-slate-200 disabled:opacity-40"
          disabled={!previous}
          onClick={() => previous && onSelect(previous.id)}
          type="button"
        >
          <ChevronLeft className="mx-auto h-5 w-5" />
        </button>
        <div className="min-w-0 text-center">
          <p className="font-bold text-slate-900">Entry {index + 1} of {entries.length}</p>
          {selected ? <p className="mt-1 text-xs font-semibold capitalize text-slate-500">{stateLabel(selected.state)}</p> : null}
        </div>
        <button
          aria-label="Next paper entry"
          className="min-h-11 min-w-11 rounded-lg border border-slate-200 disabled:opacity-40"
          disabled={!next}
          onClick={() => next && onSelect(next.id)}
          type="button"
        >
          <ChevronRight className="mx-auto h-5 w-5" />
        </button>
      </div>
      <div className="mt-3 flex gap-1 overflow-x-auto pb-1" aria-label="Paper entry status shortcuts">
        {entries.map((entry, entryIndex) => (
          <button
            aria-label={`Open paper entry ${entryIndex + 1}`}
            className={entry.id === selectedId
              ? "min-h-8 shrink-0 rounded-full bg-orange-600 px-3 text-xs font-bold text-white"
              : "min-h-8 shrink-0 rounded-full bg-slate-100 px-3 text-xs font-semibold capitalize text-slate-700"}
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            type="button"
          >
            {entryIndex + 1} · {stateLabel(entry.state)}
          </button>
        ))}
      </div>
    </div>
  );
}
