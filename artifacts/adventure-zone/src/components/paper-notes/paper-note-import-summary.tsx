import type { PaperNoteImportSummary as Summary } from "@/features/paper-notes/paper-note-types";

export function PaperNoteImportSummary({ summary }: { summary: Summary }) {
  const items = [
    ["Profiles created", summary.profilesCreated],
    ["Existing profiles linked/updated", summary.profilesUpdated],
    ["Locations created", summary.locationsCreated],
    ["Contacts created", summary.contactsCreated],
    ["Existing contacts linked", summary.contactsLinked],
    ["Phones created/updated", summary.phonesCreatedOrUpdated],
    ["Historical notes added", summary.historicalNotesCreated],
    ["Current follow-ups created", summary.followUpsCreated],
    ["Entries skipped", summary.entriesSkipped],
  ] as const;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Import completed</p>
      <h2 className="mt-1 text-xl font-bold text-emerald-950">Paper notes are in Command Center</h2>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map(([label, count]) => (
          <div className="rounded-lg bg-white/75 p-3" key={label}>
            <dt className="text-xs font-semibold text-slate-500">{label}</dt>
            <dd className="mt-1 text-lg font-bold text-slate-900">{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
