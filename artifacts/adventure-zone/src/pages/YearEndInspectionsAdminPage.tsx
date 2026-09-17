import { useCallback, useEffect, useMemo, useState } from "react";

import { InspectionRecordView, type InspectionRecordDto } from "@/components/year-end-inspections/inspection-record-view";
import { apiFetch, apiGet } from "@/lib/auth-token";

export type AdminInspectionApi = <T>(path: string, options?: RequestInit) => Promise<T>;
type LegOption = { id: string; name: string };

export function YearEndInspectionsAdminContent({ api, legs }: { api: AdminInspectionApi; legs: LegOption[] }) {
  const [inspections, setInspections] = useState<InspectionRecordDto[]>([]);
  const [selectedInspectionId, setSelectedInspectionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const inspectionData = await api<{ inspections: InspectionRecordDto[] }>("/manager-admin/year-end-inspections");
      setInspections([...(inspectionData.inspections ?? [])]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load year-end records");
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function reopen(inspection: InspectionRecordDto) {
    if (!window.confirm(`Reopen the ${inspection.inspectionYear} inspection?`)) return;
    const response = await api<{ inspection: InspectionRecordDto }>(`/manager-admin/year-end-inspections/${inspection.id}/reopen`, { method: "POST", body: "{}" });
    setInspections((current) => current.map((row) => row.id === inspection.id ? response.inspection : row));
    setNotice("Inspection reopened for the leg manager.");
  }

  async function resolveRepair(itemId: string) {
    const resolutionNotes = window.prompt("Repair completion notes");
    if (!resolutionNotes?.trim()) return;
    await api(`/manager-admin/year-end-inspection-maintenance/${itemId}/resolve`, { method: "POST", body: JSON.stringify({ resolutionNotes }) });
    await load();
  }

  async function resetInspection(inspection: InspectionRecordDto) {
    const managerName = inspection.managerIdentitySnapshot?.replace(/^manager:/, "") || "this manager";
    if (!window.confirm(`Fully reset ${managerName}'s ${inspection.inspectionYear} inspection? This permanently removes its photos, notes, and attractions added during the inspection.`)) return;
    const result = await api<{ ok: true; deletedPhotos: number; deletedPieces: number }>(`/manager-admin/year-end-inspections/${inspection.id}/reset`, {
      method: "POST",
      body: JSON.stringify({ deleteDiscoveredPieces: true }),
    });
    setSelectedInspectionId("");
    await load();
    setNotice(`${managerName}'s ${inspection.inspectionYear} inspection was reset. ${result.deletedPhotos} ${result.deletedPhotos === 1 ? "photo" : "photos"} and ${result.deletedPieces} ${result.deletedPieces === 1 ? "attraction added" : "attractions added"} during the inspection ${result.deletedPieces === 1 ? "was" : "were"} removed.`);
  }

  async function openInspection(inspectionId: string) {
    setSelectedInspectionId(inspectionId);
    const response = await api<{ inspection: InspectionRecordDto }>(`/manager-admin/year-end-inspections/${inspectionId}`);
    setInspections((current) => current.map((inspection) => inspection.id === inspectionId ? response.inspection : inspection));
  }

  const selectedInspection = inspections.find((inspection) => inspection.id === selectedInspectionId) ?? null;
  const legNames = useMemo(() => Object.fromEntries(legs.map((leg) => [leg.id, leg.name])), [legs]);

  return <div className="grid gap-6">
    <header><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Equipment & maintenance</p><h1 className="text-3xl font-bold">Year-End Inspections</h1><p className="mt-1 text-sm text-slate-600">Review each leg’s attraction inspections, photos, notes, and repairs.</p></header>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">{notice}</p> : null}
    <section className="grid gap-3">
      <h2 className="text-xl font-bold">Leg inspection records</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{inspections.map((inspection) => <button key={inspection.id} type="button" className="rounded-xl border bg-white p-4 text-left" onClick={() => void openInspection(inspection.id)}><span className="font-bold">{legNames[inspection.legId] ?? "Travel leg"} · {inspection.inspectionYear}</span><span className="mt-1 block text-sm">{inspection.progress.inspected + inspection.progress.notPresent} of {inspection.progress.total} inspected · {inspection.status}</span><span className="block text-sm text-rose-700">{inspection.progress.needsAttention} need repair</span></button>)}</div>
      {!inspections.length ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No year-end inspections have been started.</p> : null}
      {selectedInspection ? <div className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-xl font-bold">{legNames[selectedInspection.legId] ?? "Travel leg"} {selectedInspection.inspectionYear} record</h2><p className="text-sm text-slate-600">Manager: {selectedInspection.managerIdentitySnapshot?.replace(/^manager:/, "") ?? "Unknown"}</p></div><div className="flex flex-wrap gap-2">{selectedInspection.status === "completed" ? <button type="button" className="button-secondary" onClick={() => void reopen(selectedInspection)}>Reopen inspection</button> : null}<button type="button" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 font-semibold text-rose-800" onClick={() => void resetInspection(selectedInspection)}>Fully reset inspection</button></div></div><InspectionRecordView inspection={selectedInspection} onResolveRepair={(id) => void resolveRepair(id)} /></div> : null}
    </section>
  </div>;
}

const defaultApi: AdminInspectionApi = async <T,>(path: string, options?: RequestInit) => {
  const response = await apiFetch(path, options);
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? `API ${response.status}`);
  return response.json() as Promise<T>;
};

export default function YearEndInspectionsAdminPage() {
  const [legs, setLegs] = useState<LegOption[]>([]);
  useEffect(() => { apiGet<{ travelLegs?: LegOption[] }>("/routes").then((data) => setLegs(data.travelLegs ?? [])).catch(() => undefined); }, []);
  return <YearEndInspectionsAdminContent api={defaultApi} legs={legs} />;
}
