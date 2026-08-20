import { useState } from "react";
import { FileImage } from "lucide-react";

import { getPaperNoteActivitySource } from "@/features/paper-notes/paper-note-client";

type PaperNoteHistoryItem = {
  id: string;
  body?: string | null;
  historicalDateUnknown?: boolean;
  paperNoteSource?: { activityId: string } | null;
};

export function PaperNoteHistorySources({ notes }: { notes: PaperNoteHistoryItem[] }) {
  const paperNotes = notes.filter((note) => note.paperNoteSource?.activityId);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!paperNotes.length) return null;

  async function openSource(activityId: string) {
    if (opening) return;
    setOpening(activityId);
    setError("");
    try {
      const source = await getPaperNoteActivitySource(activityId);
      window.open(source.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the source paper.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <details className="rounded-xl border border-orange-200 bg-orange-50 p-4">
      <summary className="cursor-pointer font-semibold text-orange-950">
        Paper note history ({paperNotes.length})
      </summary>
      <p className="mt-2 text-sm text-orange-900">
        Imported paper history is read-only. Use the source image to verify anything uncertain.
      </p>
      {error ? <p className="mt-3 rounded-lg bg-white p-3 text-sm text-rose-800" role="alert">{error}</p> : null}
      <ul className="mt-3 grid gap-2">
        {paperNotes.map((note) => {
          const activityId = note.paperNoteSource!.activityId;
          const preview = String(note.body ?? "Imported from paper notes")
            .replace(/^Imported from paper notes\s*/i, "")
            .trim()
            .slice(0, 220);
          return (
            <li className="rounded-lg border border-orange-200 bg-white p-3" key={note.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">Imported from paper notes</p>
                  {note.historicalDateUnknown ? (
                    <p className="mt-1 text-xs font-semibold text-amber-800">Historical date unknown</p>
                  ) : null}
                  {preview ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{preview}{String(note.body ?? "").length > 220 ? "…" : ""}</p> : null}
                </div>
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-900 disabled:opacity-50"
                  disabled={Boolean(opening)}
                  onClick={() => void openSource(activityId)}
                  type="button"
                >
                  <FileImage className="h-4 w-4" />
                  {opening === activityId ? "Opening…" : "View source paper"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
