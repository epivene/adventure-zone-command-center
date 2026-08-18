import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { ManagerSyncStatus } from "@/components/manager/manager-sync-status";

function Detail({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return <p className="text-sm"><span className="font-semibold">{label}:</span> {String(value)}</p>;
}

type Notice = { state: "synced" | "needs_attention"; text: string } | null;

type IncidentRow = {
  id: string;
  type: string;
  occurredAt: string;
  locationText?: string | null;
  peopleInvolved?: string | null;
  description: string;
  actionTaken?: string | null;
  followUpNeeded: boolean;
  attachments?: Array<{ id: string; imageStatus: string; imageUrl?: string | null }>;
};

function IncidentEditor({ row, onCancel, onSaved }: { row: IncidentRow; onCancel(): void; onSaved(): Promise<void> }) {
  const { managerApi } = useManagerAuth();
  const [type, setType] = useState(row.type);
  const [description, setDescription] = useState(row.description);
  const [action, setAction] = useState(row.actionTaken ?? "");
  const [people, setPeople] = useState(row.peopleInvolved ?? "");
  const [location, setLocation] = useState(row.locationText ?? "");
  const [follow, setFollow] = useState(row.followUpNeeded);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!type.trim() || !description.trim() || busy) return;
    setBusy(true);
    try {
      await managerApi(`/manager/incidents/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: type.trim(),
          description: description.trim(),
          actionTaken: action.trim() || null,
          peopleInvolved: people.trim() || null,
          locationText: location.trim() || null,
          followUpNeeded: follow,
        }),
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid gap-3 border-t p-4">
    <h3 className="font-bold">Edit incident</h3>
    <label className="grid gap-1 text-sm font-semibold">Incident type<input value={type} onChange={(event) => setType(event.target.value)} /></label>
    <label className="grid gap-1 text-sm font-semibold">Location<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
    <label className="grid gap-1 text-sm font-semibold">People involved<textarea value={people} onChange={(event) => setPeople(event.target.value)} /></label>
    <label className="grid gap-1 text-sm font-semibold">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <label className="grid gap-1 text-sm font-semibold">Action taken<textarea value={action} onChange={(event) => setAction(event.target.value)} /></label>
    <label className="flex gap-2"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />Follow-up needed</label>
    <div className="flex flex-wrap gap-2"><button className="button-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button><button className="button-secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </div>;
}

export default function ManagerIncidentsPage() {
  const { managerApi } = useManagerAuth();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function load() {
    const data = await managerApi<{ incidents?: IncidentRow[] }>("/manager/incidents");
    setRows(data.incidents ?? []);
  }

  useEffect(() => { void load().catch(() => setRows([])); }, [managerApi]);

  async function deleteIncident(row: IncidentRow) {
    if (!window.confirm("Delete this incident and its uploaded photo(s)? This cannot be undone.")) return;
    try {
      await managerApi(`/manager/incidents/${row.id}`, { method: "DELETE" });
      setNotice({ state: "synced", text: "Incident deleted." });
      setOpenId(null);
      await load();
    } catch (error) {
      setNotice({ state: "needs_attention", text: error instanceof Error ? error.message : "Could not delete incident." });
    }
  }

  return <div className="grid gap-4">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Incidents</h1><p className="text-sm text-slate-600">Tap an incident to see all details and photos.</p></div><Link href="/manager/incidents/new" className="button-primary">Report General Incident</Link></div>
    {notice ? <div className="grid gap-1"><ManagerSyncStatus state={notice.state} /><p className="text-sm text-slate-600">{notice.text}</p></div> : null}
    {rows.length === 0 ? <p className="rounded-xl border border-dashed bg-white p-5 text-sm text-slate-600">No incidents have been reported.</p> : null}
    {rows.map((row) => {
      const open = openId === row.id;
      const editing = editId === row.id;
      return <article key={row.id} className="rounded-xl border bg-white">
        <button type="button" aria-expanded={open} className="w-full p-4 text-left" onClick={() => { setOpenId(open ? null : row.id); setEditId(null); }}><div className="flex items-center justify-between gap-3"><b>{row.type}</b><span className="text-sm font-semibold text-orange-700">{open ? "Hide details" : "View details"}</span></div><p>{row.description}</p>{row.followUpNeeded ? <p className="font-semibold text-amber-700">Follow-up needed</p> : null}</button>
        {open && !editing ? <div className="grid gap-2 border-t p-4">
          <Detail label="Occurred" value={row.occurredAt ? new Date(row.occurredAt).toLocaleString() : null} />
          <Detail label="Location" value={row.locationText} />
          <Detail label="People involved" value={row.peopleInvolved} />
          <Detail label="Action taken" value={row.actionTaken} />
          <div className="mt-2 flex flex-wrap gap-3">{(row.attachments ?? []).map((photo) => photo.imageUrl ? <a aria-label="View incident photo" className="block" href={photo.imageUrl} key={photo.id} rel="noreferrer" target="_blank"><img alt="Incident photo" className="h-32 w-32 rounded-lg border object-cover" src={photo.imageUrl} /><span className="mt-1 block text-xs font-semibold text-orange-700">Open photo</span></a> : photo.imageStatus === "image_failed" ? <span className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" key={photo.id}>Photo upload failed. It will retry when possible.</span> : photo.imageStatus === "image_pending" ? <span className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800" key={photo.id}>Photo saved — waiting to upload.</span> : photo.imageStatus === "image_uploaded" ? <span className="text-sm text-slate-500" key={photo.id}>Photo unavailable — refresh to try again.</span> : null)}</div>
          {(row.attachments ?? []).length === 0 ? <p className="text-sm text-slate-500">No photo attached.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2"><button className="button-secondary" type="button" onClick={() => setEditId(row.id)}>Edit incident</button><button className="button-secondary text-rose-700" type="button" onClick={() => void deleteIncident(row)}>Delete incident</button></div>
        </div> : null}
        {open && editing ? <IncidentEditor row={row} onCancel={() => setEditId(null)} onSaved={async () => { setEditId(null); setNotice({ state: "synced", text: "Incident changes saved." }); await load(); }} /> : null}
      </article>;
    })}
  </div>;
}
