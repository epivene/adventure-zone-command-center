import { X } from "lucide-react";

import type { PaperNoteBatchPreflight } from "@/features/paper-notes/paper-note-types";

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function PaperNoteBatchPreflightDialog({
  preflight,
  busy,
  onClose,
  onConfirm,
}: {
  preflight: PaperNoteBatchPreflight;
  busy: boolean;
  onClose(): void;
  onConfirm(): void;
}) {
  const p = preflight.preview;
  const rows = [
    countLabel(p.profilesCreated, "new profile"),
    countLabel(p.profilesUpdated, "existing profile linked/updated", "existing profiles linked/updated"),
    countLabel(p.locationsCreated, "new location"),
    countLabel(p.contactsCreated, "new contact"),
    countLabel(p.contactsLinked, "existing contact linked", "existing contacts linked"),
    countLabel(p.phonesCreatedOrUpdated, "phone created/updated", "phones created/updated"),
    countLabel(p.historicalNotesCreated, "historical note"),
    p.followUpsCreated === 0 ? "No current follow-ups" : countLabel(p.followUpsCreated, "current follow-up"),
    countLabel(p.entriesSkipped, "entry skipped", "entries skipped"),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3" role="presentation">
      <div aria-labelledby="paper-note-preflight-title" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" role="dialog">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Final check</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950" id="paper-note-preflight-title">Import approved paper notes?</h2>
            <p className="mt-1 text-sm text-slate-600">Nothing below happens until you confirm this batch import.</p>
          </div>
          <button aria-label="Close import review" className="min-h-11 min-w-11 rounded-lg border border-slate-200" disabled={busy} onClick={onClose} type="button"><X className="mx-auto h-5 w-5" /></button>
        </div>

        {preflight.blocking.length ? (
          <div className="mt-4 rounded-xl bg-rose-50 p-3" role="alert">
            <p className="font-bold text-rose-900">This batch is not ready yet.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800">
              {preflight.blocking.map((item, index) => <li key={`${item.code}:${item.entryId ?? "batch"}:${index}`}>{item.message}</li>)}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-bold text-slate-900">Planned changes</p>
          <ul className="mt-2 grid gap-1 text-sm text-slate-700">
            {rows.map((row) => <li key={row}>{row}</li>)}
          </ul>
          <p className="mt-3 text-xs font-semibold text-slate-500">{preflight.approvedCount} approved · {preflight.skippedCount} skipped</p>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="min-h-12 rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-800" disabled={busy} onClick={onClose} type="button">Keep reviewing</button>
          <button className="min-h-12 rounded-xl bg-orange-600 px-4 py-3 font-bold text-white disabled:opacity-50" disabled={!preflight.ready || busy} onClick={onConfirm} type="button">
            {busy ? "Importing…" : "Import Approved Entries"}
          </button>
        </div>
      </div>
    </div>
  );
}
