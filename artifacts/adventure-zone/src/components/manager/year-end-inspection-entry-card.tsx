import { useState } from "react";

import { InspectionPhotoEditorContent } from "@/components/manager/inspection-photo-editor";
import type { InspectionCondition, ManagerApi, YearEndInspectionEntryDto } from "@/lib/year-end-inspections-api";

type EntryPatch = Partial<Pick<YearEndInspectionEntryDto, "entryState" | "condition" | "inspectionNotes" | "repairNeeded" | "repairNotes" | "retainForFutureUse">>;

const attentionConditions = new Set<InspectionCondition>(["minor_repair", "major_repair", "replace", "retired"]);

export function YearEndInspectionEntryCard({
  entry,
  inspectionId,
  legId,
  managerApi,
  onSave,
  initiallyOpen = false,
}: {
  entry: YearEndInspectionEntryDto;
  inspectionId: string;
  legId: string;
  managerApi: ManagerApi;
  onSave: (entryId: string, patch: EntryPatch) => Promise<void>;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [condition, setCondition] = useState<InspectionCondition | "">(entry.condition ?? "");
  const [notes, setNotes] = useState(entry.inspectionNotes ?? "");
  const [repairNotes, setRepairNotes] = useState(entry.repairNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!condition) return;
    setSaving(true);
    try {
      await onSave(entry.id, {
        entryState: "inspected",
        condition,
        inspectionNotes: notes.trim() || null,
        repairNeeded: attentionConditions.has(condition),
        repairNotes: repairNotes.trim() || null,
        retainForFutureUse: condition !== "retired",
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen((value) => !value)}>
      <span>
        <span className="block font-bold">{entry.pieceCodeSnapshot} {entry.pieceNameSnapshot}</span>
        <span className="block text-sm text-slate-600">{entry.resourceNameSnapshot ?? "Unassigned piece"}</span>
      </span>
      <span className={`rounded-full px-2 py-1 text-xs font-bold ${entry.entryState === "not_started" ? "bg-slate-100" : entry.repairNeeded ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>
        {entry.entryState === "not_started" ? "Not started" : entry.entryState === "not_present" ? "Not present" : entry.repairNeeded ? "Needs attention" : "Inspected"}
      </span>
    </button>
    {open ? <div className="grid gap-3 border-t p-4">
      <label className="grid gap-1 text-sm font-semibold">Condition
        <select aria-label="Condition" className="min-h-11 rounded-lg border p-2" value={condition} onChange={(event) => setCondition(event.target.value as InspectionCondition)}>
          <option value="">Choose condition</option>
          <option value="good">Good</option>
          <option value="needs_cleaning">Needs cleaning</option>
          <option value="minor_repair">Minor repair</option>
          <option value="major_repair">Major repair</option>
          <option value="replace">Replace</option>
          <option value="retired">Retire piece</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">Inspection notes
        <textarea aria-label="Inspection notes" className="min-h-28 rounded-lg border p-2" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {condition && attentionConditions.has(condition) ? <label className="grid gap-1 text-sm font-semibold">Repair notes
        <textarea aria-label="Repair notes" className="min-h-20 rounded-lg border p-2" value={repairNotes} onChange={(event) => setRepairNotes(event.target.value)} />
      </label> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className="min-h-11 rounded-lg border font-semibold" onClick={() => void onSave(entry.id, { entryState: "not_present", condition: null, repairNeeded: false })}>Mark not present</button>
        <button type="button" className="button-primary min-h-11" disabled={!condition || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save piece inspection"}</button>
      </div>
      <InspectionPhotoEditorContent inspectionId={inspectionId} entryId={entry.id} legId={legId} managerApi={managerApi} />
    </div> : null}
  </article>;
}
