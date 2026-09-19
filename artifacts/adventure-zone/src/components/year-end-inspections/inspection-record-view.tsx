import { ellipseStyle, type PhotoEllipse } from "@/lib/inspection-photo-annotations";
import type { YearEndInspectionDto } from "@/lib/year-end-inspections-api";

export type InspectionPhotoDto = { id: string; signedUrl: string; description: string | null; annotations: { version: 1; ellipses: PhotoEllipse[] } };
export type InspectionRecordDto = Omit<YearEndInspectionDto, "entries"> & {
  managerIdentitySnapshot?: string | null;
  entries: Array<YearEndInspectionDto["entries"][number] & { photos?: InspectionPhotoDto[]; maintenanceItem?: { id: string; state: "open" | "resolved"; resolutionNotes: string | null } | null }>;
};

function entryStatusLabel(entry: InspectionRecordDto["entries"][number]) {
  if (entry.entryState === "not_started") return "Not started";
  if (entry.entryState === "not_present") return "Not present";
  if (entry.repairNeeded) return "Needs attention";
  if (entry.condition === "good") return "All Good";
  if (entry.condition === "needs_cleaning") return "Needs cleaning";
  return "Inspected";
}

export function InspectionRecordView({ inspection, onResolveRepair }: { inspection: InspectionRecordDto; onResolveRepair?: (itemId: string) => void }) {
  return <div className="grid gap-3">
    {inspection.entries.map((entry) => <article key={entry.id} data-print-entry className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{entry.pieceCodeSnapshot} {entry.pieceNameSnapshot}</h3><p className="text-sm text-slate-600">{entry.resourceNameSnapshot ?? "Unassigned piece"}</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{entryStatusLabel(entry)}</span></div>
      {entry.condition ? <p className="mt-3 text-sm"><strong>Original condition:</strong> {entry.condition.replaceAll("_", " ")}</p> : null}
      {entry.inspectionNotes ? <p className="mt-1 whitespace-pre-wrap text-sm">{entry.inspectionNotes}</p> : null}
      {entry.repairNotes ? <p className="mt-1 whitespace-pre-wrap text-sm text-rose-800"><strong>Repair:</strong> {entry.repairNotes}</p> : null}
      <p className="mt-1 text-sm">Retained for future use: {entry.retainForFutureUse ? "Yes" : "No"}</p>
      {entry.photos?.map((photo) => <figure key={photo.id} className="mt-3 overflow-hidden rounded-lg border">
        <div className="relative"><img src={photo.signedUrl} alt={photo.description ?? `${entry.pieceCodeSnapshot} inspection photo`} className="w-full" />{photo.annotations.ellipses.map((ellipse) => <span key={ellipse.id} aria-label="Marked photo area" className="pointer-events-none absolute rounded-full border-4 border-rose-500" style={ellipseStyle(ellipse)} />)}</div>
        {photo.description ? <figcaption className="bg-slate-50 p-3 text-sm">{photo.description}</figcaption> : null}
      </figure>)}
      {entry.maintenanceItem ? <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><p className="font-bold">Repair follow-up: {entry.maintenanceItem.state}</p>{entry.maintenanceItem.resolutionNotes ? <p>{entry.maintenanceItem.resolutionNotes}</p> : null}{entry.maintenanceItem.state === "open" && onResolveRepair ? <button type="button" className="mt-2 rounded-lg border bg-white px-3 py-2 font-semibold" onClick={() => onResolveRepair(entry.maintenanceItem!.id)}>Mark repair completed</button> : null}</div> : null}
    </article>)}
  </div>;
}

