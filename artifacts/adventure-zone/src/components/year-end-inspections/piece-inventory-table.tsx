import { useMemo, useState } from "react";

export type EquipmentPieceDto = {
  id: string;
  code: string;
  name: string;
  pieceType: string;
  currentLegId: string | null;
  storageLocation: string | null;
  identityNotes: string | null;
  lifecycleStatus: "active" | "stored_spare" | "needs_repair" | "replace" | "retired";
  currentResourceId: string | null;
  currentResourceName: string | null;
  archivedAt: string | null;
};

export type ResourceOption = { id: string; name: string; legId: string | null };

export function PieceInventoryTable({ pieces, legNames, resources = [], onTransfer, onRegroup, onArchive, onRestore }: { pieces: EquipmentPieceDto[]; legNames: Record<string, string>; resources?: ResourceOption[]; onTransfer?: (pieceId: string, legId: string) => void; onRegroup?: (pieceId: string, resourceId: string | null) => void; onArchive?: (pieceId: string) => void; onRestore?: (pieceId: string) => void }) {
  const [search, setSearch] = useState("");
  const [leg, setLeg] = useState("all");
  const [status, setStatus] = useState("all");
  const visible = useMemo(() => pieces.filter((piece) => {
    const query = search.trim().toLowerCase();
    return (!query || `${piece.code} ${piece.name} ${piece.currentResourceName ?? ""} ${piece.storageLocation ?? ""}`.toLowerCase().includes(query))
      && (leg === "all" || (leg === "unassigned" ? !piece.currentLegId : piece.currentLegId === leg))
      && (status === "all" || piece.lifecycleStatus === status);
  }), [leg, pieces, search, status]);

  return <section className="grid gap-3">
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="grid gap-1 text-sm font-semibold">Search inventory<input className="min-h-11 rounded-lg border px-3" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-semibold">Filter by leg<select className="min-h-11 rounded-lg border px-2" value={leg} onChange={(event) => setLeg(event.target.value)}><option value="all">All legs</option><option value="unassigned">Unassigned / spare</option>{Object.entries(legNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">Lifecycle<select className="min-h-11 rounded-lg border px-2" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="stored_spare">Stored spare</option><option value="needs_repair">Needs repair</option><option value="replace">Replace</option><option value="retired">Retired</option></select></label>
    </div>
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-3">Code</th><th className="p-3">Piece</th><th className="p-3">Attraction</th><th className="p-3">Leg</th><th className="p-3">Storage</th><th className="p-3">Status</th><th className="p-3">Manage</th></tr></thead>
        <tbody>{visible.map((piece) => <tr key={piece.id} className="border-t"><td className="p-3 font-bold">{piece.code}</td><td className="p-3">{piece.name}<span className="block text-xs text-slate-500">{piece.pieceType.replaceAll("_", " ")}</span></td><td className="p-3">{piece.currentResourceName ?? "Unassigned"}</td><td className="p-3">{piece.currentLegId ? legNames[piece.currentLegId] ?? "Unknown leg" : "Spare"}</td><td className="p-3">{piece.storageLocation ?? "—"}</td><td className="p-3">{piece.lifecycleStatus.replaceAll("_", " ")}</td><td className="p-3"><div className="grid min-w-44 gap-2">{onTransfer ? <select aria-label={`Transfer ${piece.code} to leg`} value={piece.currentLegId ?? ""} onChange={(event) => event.target.value && onTransfer(piece.id, event.target.value)}><option value="">Choose leg</option>{Object.entries(legNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select> : null}{onRegroup ? <select aria-label={`Group ${piece.code} into attraction`} value={piece.currentResourceId ?? ""} onChange={(event) => onRegroup(piece.id, event.target.value || null)}><option value="">Unassigned attraction</option>{resources.filter((resource) => !resource.legId || resource.legId === piece.currentLegId).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select> : null}{piece.archivedAt ? <button type="button" className="rounded border px-2 py-1" onClick={() => onRestore?.(piece.id)}>Restore</button> : <button type="button" className="rounded border px-2 py-1" onClick={() => onArchive?.(piece.id)}>Archive</button>}</div></td></tr>)}</tbody>
      </table>
      {!visible.length ? <p className="p-4 text-sm text-slate-500">No pieces match these filters.</p> : null}
    </div>
  </section>;
}
