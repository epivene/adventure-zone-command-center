import { useCallback, useEffect, useMemo, useState } from "react";

import { InspectionRecordView, type InspectionRecordDto } from "@/components/year-end-inspections/inspection-record-view";
import { PieceInventoryTable, type EquipmentPieceDto, type ResourceOption } from "@/components/year-end-inspections/piece-inventory-table";
import { apiFetch, apiGet } from "@/lib/auth-token";

export type AdminInspectionApi = <T>(path: string, options?: RequestInit) => Promise<T>;
type LegOption = { id: string; name: string };

const emptyForm = {
  code: "",
  name: "",
  pieceType: "inflatable_component",
  currentLegId: "",
  storageLocation: "",
  identityNotes: "",
  resourceId: "",
};

export function YearEndInspectionsAdminContent({ api, legs, resources = [] }: { api: AdminInspectionApi; legs: LegOption[]; resources?: ResourceOption[] }) {
  const [pieces, setPieces] = useState<EquipmentPieceDto[]>([]);
  const [inspections, setInspections] = useState<InspectionRecordDto[]>([]);
  const [selectedInspectionId, setSelectedInspectionId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [pieceData, inspectionData] = await Promise.all([
        api<{ pieces: EquipmentPieceDto[] }>("/manager-admin/equipment-pieces?includeArchived=true"),
        api<{ inspections: InspectionRecordDto[] }>("/manager-admin/year-end-inspections"),
      ]);
      setPieces([...(pieceData.pieces ?? [])]);
      setInspections([...(inspectionData.inspections ?? [])]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load year-end records");
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function savePiece(addAnother: boolean) {
    setError("");
    const response = await api<{ piece: EquipmentPieceDto }>("/manager-admin/equipment-pieces", {
      method: "POST",
      body: JSON.stringify({
        clientMutationId: crypto.randomUUID(),
        code: form.code,
        name: form.name,
        pieceType: form.pieceType,
        currentLegId: form.currentLegId || null,
        storageLocation: form.storageLocation || null,
        identityNotes: form.identityNotes || null,
        lifecycleStatus: "active",
        resourceId: form.resourceId || null,
      }),
    });
    setPieces((current) => [...current, response.piece]);
    setNotice(`${response.piece.code} added. Inventory now has ${pieces.length + 1} pieces.`);
    setForm((current) => addAnother
      ? { ...current, code: "", name: "", identityNotes: "" }
      : emptyForm);
    if (!addAnother) setShowAdd(false);
  }

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

  async function updatePiece(path: string, options: RequestInit) {
    const response = await api<{ piece: EquipmentPieceDto }>(path, options);
    setPieces((current) => current.map((piece) => piece.id === response.piece.id ? response.piece : piece));
  }

  async function openInspection(inspectionId: string) {
    setSelectedInspectionId(inspectionId);
    const response = await api<{ inspection: InspectionRecordDto }>(`/manager-admin/year-end-inspections/${inspectionId}`);
    setInspections((current) => current.map((inspection) => inspection.id === inspectionId ? response.inspection : inspection));
  }

  const selectedInspection = inspections.find((inspection) => inspection.id === selectedInspectionId) ?? null;
  const legNames = useMemo(() => Object.fromEntries(legs.map((leg) => [leg.id, leg.name])), [legs]);

  return <div className="grid gap-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Equipment & maintenance</p><h1 className="text-3xl font-bold">Year-End Inspections</h1><p className="mt-1 text-sm text-slate-600">Track every physical inflatable piece, group components into attractions, and preserve each leg’s annual record.</p></div>
      <button type="button" className="button-primary" onClick={() => setShowAdd((value) => !value)}>Add piece</button>
    </header>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">{notice}</p> : null}
    {showAdd ? <section className="grid gap-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-bold">Add an inflatable piece</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Piece code<input aria-label="Piece code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>
        <label className="grid gap-1 text-sm font-semibold">Piece name<input aria-label="Piece name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="grid gap-1 text-sm font-semibold">Leg<select aria-label="Leg" value={form.currentLegId} onChange={(event) => setForm({ ...form, currentLegId: event.target.value })}><option value="">Unassigned / spare</option>{legs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Piece type<input aria-label="Piece type" value={form.pieceType} onChange={(event) => setForm({ ...form, pieceType: event.target.value })} /></label>
        <label className="grid gap-1 text-sm font-semibold">Attraction group<select aria-label="Attraction group" value={form.resourceId} onChange={(event) => setForm({ ...form, resourceId: event.target.value })}><option value="">Unassigned</option>{resources.filter((resource) => !form.currentLegId || !resource.legId || resource.legId === form.currentLegId).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Storage location<input aria-label="Storage location" value={form.storageLocation} onChange={(event) => setForm({ ...form, storageLocation: event.target.value })} /></label>
        <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Identity notes<textarea aria-label="Identity notes" value={form.identityNotes} onChange={(event) => setForm({ ...form, identityNotes: event.target.value })} /></label>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" className="button-primary" disabled={!form.code.trim() || !form.name.trim()} onClick={() => void savePiece(true)}>Save and add another</button><button type="button" className="button-secondary" disabled={!form.code.trim() || !form.name.trim()} onClick={() => void savePiece(false)}>Save piece</button></div>
    </section> : null}
    <section className="grid gap-3"><div><h2 className="text-xl font-bold">Piece inventory</h2><p className="text-sm text-slate-600">{pieces.length} pieces total; there is no fixed limit.</p></div><PieceInventoryTable pieces={pieces} legNames={legNames} resources={resources} onTransfer={(pieceId, nextLegId) => void updatePiece(`/manager-admin/equipment-pieces/${pieceId}/transfer`, { method: "POST", body: JSON.stringify({ legId: nextLegId }) })} onRegroup={(pieceId, resourceId) => void updatePiece(`/manager-admin/equipment-pieces/${pieceId}/regroup`, { method: "POST", body: JSON.stringify({ resourceId, reason: "Updated in year-end inventory" }) })} onArchive={(pieceId) => { if (window.confirm("Archive this piece? Its history will be kept.")) void updatePiece(`/manager-admin/equipment-pieces/${pieceId}/archive`, { method: "POST", body: "{}" }); }} onRestore={(pieceId) => void updatePiece(`/manager-admin/equipment-pieces/${pieceId}/restore`, { method: "POST", body: "{}" })} /></section>
    <section className="grid gap-3">
      <h2 className="text-xl font-bold">Inspection records</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{inspections.map((inspection) => <button key={inspection.id} type="button" className="rounded-xl border bg-white p-4 text-left" onClick={() => void openInspection(inspection.id)}><span className="font-bold">{legNames[inspection.legId] ?? "Travel leg"} · {inspection.inspectionYear}</span><span className="mt-1 block text-sm">{inspection.progress.inspected + inspection.progress.notPresent} of {inspection.progress.total} inspected · {inspection.status}</span><span className="block text-sm text-rose-700">{inspection.progress.needsAttention} need repair</span></button>)}</div>
      {!inspections.length ? <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No year-end inspections have been started.</p> : null}
      {selectedInspection ? <div className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">{legNames[selectedInspection.legId] ?? "Travel leg"} {selectedInspection.inspectionYear} record</h2>{selectedInspection.status === "completed" ? <button type="button" className="button-secondary" onClick={() => void reopen(selectedInspection)}>Reopen inspection</button> : null}</div><InspectionRecordView inspection={selectedInspection} onResolveRepair={(id) => void resolveRepair(id)} /></div> : null}
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
  const [resources, setResources] = useState<ResourceOption[]>([]);
  useEffect(() => { apiGet<{ travelLegs?: LegOption[]; legResources?: ResourceOption[] }>("/routes").then((data) => { setLegs(data.travelLegs ?? []); setResources(data.legResources ?? []); }).catch(() => undefined); }, []);
  return <YearEndInspectionsAdminContent api={defaultApi} legs={legs} resources={resources} />;
}
