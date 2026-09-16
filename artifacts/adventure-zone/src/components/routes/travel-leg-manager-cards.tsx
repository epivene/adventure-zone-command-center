import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp } from "lucide-react";
import type { TravelLegDetails, TravelLegOrder } from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import type { LegManagerAccessStatus, LegResourceSummary } from "./travel-leg-editor";
import { Link } from "wouter";

export type YearEndInspectionLegSummaryValue = NonNullable<LegResourceSummary["yearEndInspectionSummary"]>;

export function YearEndInspectionLegSummary({ summary }: { summary?: YearEndInspectionLegSummaryValue }) {
  if (!summary) return <p className="text-sm text-slate-600">No inspection started</p>;
  return <div className="text-sm"><p className="font-semibold">{summary.status === "completed" ? "Completed" : `${summary.inspected} of ${summary.total} inspected`}</p>{summary.needsAttention > 0 ? <p className="text-rose-700">{summary.needsAttention} need repair</p> : <p className="text-emerald-700">No repairs flagged</p>}</div>;
}

type SaveLegResult = { ok: true; leg: TravelLeg } | { ok: false; error: string };
type SaveOrderResult = { ok: true; legs: TravelLeg[] } | { ok: false; error: string };
type FormLeg = { id: string; name: string; color: string; sortOrder: number; baseAddress: string; defaultVehicleName: string; defaultMpg: string };

function formLeg(leg: TravelLeg): FormLeg {
  return { id: leg.id, name: leg.name, color: leg.color, sortOrder: leg.sortOrder, baseAddress: leg.baseAddress ?? "", defaultVehicleName: leg.defaultVehicleName ?? "", defaultMpg: leg.defaultMpg == null ? "" : String(leg.defaultMpg) };
}
function input(leg: FormLeg): TravelLegDetails {
  return { name: leg.name.trim(), color: leg.color, baseAddress: leg.baseAddress.trim(), defaultVehicleName: leg.defaultVehicleName.trim(), defaultMpg: leg.defaultMpg } as TravelLegDetails;
}

export function TravelLegManagerCards({
  legs, legResources = [], managerAccess = [], onSaveLeg, onSaveOrder, onAdd, onArchive, onRestore, onSetManagerPassword, onSignOutManagerDevices,
}: {
  legs: TravelLeg[];
  legResources?: LegResourceSummary[];
  managerAccess?: LegManagerAccessStatus[];
  onSaveLeg: (id: string, input: TravelLegDetails) => Promise<SaveLegResult> | SaveLegResult;
  onSaveOrder: (input: TravelLegOrder) => Promise<SaveOrderResult> | SaveOrderResult;
  onAdd?: () => Promise<void>;
  onArchive?: (id: string) => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
  onSetManagerPassword?: (legId: string, password: string) => Promise<void>;
  onSignOutManagerDevices?: (legId: string) => Promise<void>;
}) {
  const initial = useMemo(() => legs.filter((leg) => !leg.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder), [legs]);
  const archived = legs.filter((leg) => leg.archivedAt);
  const [values, setValues] = useState<FormLeg[]>(() => initial.map(formLeg));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reorderMode, setReorderMode] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [orderDirty, setOrderDirty] = useState(false);

  function change(id: string, field: keyof FormLeg, value: string) {
    setValues((current) => current.map((leg) => leg.id === id ? { ...leg, [field]: value } : leg));
  }
  function toggle(id: string) {
    setExpanded((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    setValues((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((leg, position) => ({ ...leg, sortOrder: position + 1 }));
    });
    setOrderDirty(true);
  }
  async function saveLeg(leg: FormLeg) {
    setBusy(leg.id); setMessage(""); setError("");
    try {
      const result = await onSaveLeg(leg.id, input(leg));
      if (!result.ok) { setError(result.error); return; }
      setValues((current) => current.map((row) => row.id === leg.id ? formLeg(result.leg) : row));
      setMessage(`${result.leg.name} saved.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this manager/leg."); }
    finally { setBusy(null); }
  }
  async function saveOrder() {
    setBusy("order"); setError("");
    try {
      const result = await onSaveOrder({ legs: values.map((leg, index) => ({ id: leg.id, sortOrder: index + 1 })) });
      if (!result.ok) { setError(result.error); return; }
      setOrderDirty(false); setMessage("Travel-leg order saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save travel-leg order."); }
    finally { setBusy(null); }
  }
  async function savePassword(legId: string, enabled: boolean) {
    const password = passwords[legId] ?? "";
    if (!password || !onSetManagerPassword) return;
    setBusy(`access:${legId}`); setError("");
    try { await onSetManagerPassword(legId, password); setPasswords((current) => ({ ...current, [legId]: "" })); setMessage(enabled ? "Manager portal password changed." : "Manager portal enabled."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update manager access."); }
    finally { setBusy(null); }
  }

  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="manager-leg-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="manager-leg-title" className="text-xl font-bold">Managers & travel legs</h2><p className="mt-1 text-sm text-slate-600">Open a manager only when you need to change their route defaults, equipment summary, or portal access.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={reorderMode ? "button-primary" : "button-secondary"} onClick={() => setReorderMode((value) => !value)}>{reorderMode ? "Done reordering" : "Reorder legs"}</button>
          {onAdd ? <button type="button" className="button-secondary" disabled={busy === "add"} onClick={async () => { setBusy("add"); try { await onAdd(); } finally { setBusy(null); } }}>{busy === "add" ? "Adding…" : "Add leg"}</button> : null}
        </div>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}

      {reorderMode ? (
        <div className="grid gap-2">
          {values.map((leg, index) => <div key={leg.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"><span className="size-3 rounded-full" style={{ backgroundColor: leg.color }} /><span className="min-w-0 flex-1 font-semibold">{index + 1}. {leg.name}</span><button aria-label={`Move leg ${index + 1} up`} type="button" disabled={index === 0} onClick={() => move(index, -1)} className="rounded p-2 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button><button aria-label={`Move leg ${index + 1} down`} type="button" disabled={index === values.length - 1} onClick={() => move(index, 1)} className="rounded p-2 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button></div>)}
          <div><button className="button-primary" type="button" disabled={!orderDirty || busy === "order"} onClick={saveOrder}>{busy === "order" ? "Saving order…" : "Save order"}</button></div>
        </div>
      ) : (
        <div className="grid gap-2">
          {values.map((leg) => {
            const access = managerAccess.find((row) => row.legId === leg.id);
            const enabled = Boolean(access?.enabled);
            const resources = legResources.filter((resource) => resource.legId === leg.id);
            const inspectionSummary = resources.find((resource) => resource.yearEndInspectionSummary)?.yearEndInspectionSummary;
            const open = expanded.has(leg.id);
            const incomplete = !leg.baseAddress || !leg.defaultVehicleName || !leg.defaultMpg;
            return <article key={leg.id} className="rounded-xl border border-slate-200 bg-white">
              <button type="button" aria-expanded={open} aria-controls={`leg-details-${leg.id}`} onClick={() => toggle(leg.id)} className="flex w-full items-center gap-3 p-4 text-left">
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: leg.color }} />
                <span className="min-w-0 flex-1"><span className="block font-bold">{leg.name}</span><span className="mt-0.5 block text-sm text-slate-600">{enabled ? "Manager enabled" : "Portal not configured"}{leg.defaultVehicleName ? ` · ${leg.defaultVehicleName}` : ""} · {resources.length} resource{resources.length === 1 ? "" : "s"}</span></span>
                {incomplete ? <span className="hidden rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 sm:inline">Setup incomplete</span> : null}
                {open ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-500" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-500" />}
              </button>
              {open ? <div id={`leg-details-${leg.id}`} className="grid gap-3 border-t border-slate-100 p-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]"><label className="grid gap-1 text-sm font-semibold">Manager / Leg name<input aria-label="Manager / Leg name" value={leg.name} onChange={(e) => change(leg.id, "name", e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Color<input aria-label={`Travel leg ${leg.sortOrder} color`} className="h-11 w-full" type="color" value={leg.color} onChange={(e) => change(leg.id, "color", e.target.value)} /></label></div>
                <label className="grid gap-1 text-sm font-semibold">Base address<input aria-label={`Travel leg ${leg.sortOrder} base address`} value={leg.baseAddress} onChange={(e) => change(leg.id, "baseAddress", e.target.value)} /></label>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]"><label className="grid gap-1 text-sm font-semibold">Default vehicle<input aria-label={`Travel leg ${leg.sortOrder} default vehicle`} value={leg.defaultVehicleName} onChange={(e) => change(leg.id, "defaultVehicleName", e.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Default MPG<input aria-label={`Travel leg ${leg.sortOrder} default MPG`} type="number" min="0" step="0.1" value={leg.defaultMpg} onChange={(e) => change(leg.id, "defaultMpg", e.target.value)} /></label></div>
                <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs font-bold uppercase text-slate-500">Assigned resources</p><p className="mt-1">{resources.length ? resources.map((resource) => resource.name).join(", ") : "No resources assigned"}</p></div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3"><div><p className="text-xs font-bold uppercase text-orange-700">Year-end inspection</p><YearEndInspectionLegSummary summary={inspectionSummary} /></div><Link className="rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm font-semibold" href={`/year-end-inspections?legId=${leg.id}&year=${new Date().getFullYear()}`}>Open record</Link></div>
                <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold">Manager portal</p><p className="text-xs text-slate-500">{enabled ? "Portal enabled" : "Portal not configured"}</p></div>{enabled && onSignOutManagerDevices ? <button className="button-secondary" type="button" disabled={busy === `access:${leg.id}`} onClick={async () => { if (!window.confirm(`Sign out all manager devices for ${leg.name}?`)) return; setBusy(`access:${leg.id}`); try { await onSignOutManagerDevices(leg.id); setMessage(`${leg.name} manager devices signed out.`); } finally { setBusy(null); } }}>Sign Out All Devices</button> : null}</div>
                  {onSetManagerPassword ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="grid gap-1 text-sm font-semibold">{enabled ? "New password" : "Password"}<input aria-label={enabled ? "New password" : "Password"} type="password" autoComplete="new-password" value={passwords[leg.id] ?? ""} onChange={(e) => setPasswords((current) => ({ ...current, [leg.id]: e.target.value }))} /></label><button className="button-primary" type="button" disabled={!passwords[leg.id] || busy === `access:${leg.id}`} onClick={() => savePassword(leg.id, enabled)}>{busy === `access:${leg.id}` ? "Saving…" : enabled ? "Change password" : "Enable portal"}</button></div> : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">{onArchive ? <button className="button-secondary" type="button" disabled={values.length <= 1 || busy === `archive:${leg.id}`} onClick={async () => { setBusy(`archive:${leg.id}`); try { await onArchive(leg.id); } finally { setBusy(null); } }}>{busy === `archive:${leg.id}` ? "Archiving…" : "Archive"}</button> : <span />}<button className="button-primary" type="button" disabled={busy === leg.id || !leg.name.trim()} onClick={() => saveLeg(leg)}>{busy === leg.id ? "Saving…" : "Save leg"}</button></div>
              </div> : null}
            </article>;
          })}
        </div>
      )}

      {archived.length ? <div><button type="button" className="button-secondary" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Hide Archived" : `View Archived (${archived.length})`}</button></div> : null}
      {showArchived ? <div className="grid gap-2">{archived.map((leg) => <div key={leg.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><span className="size-3 rounded-full" style={{ backgroundColor: leg.color }} /><span className="font-semibold">{leg.name}</span><span className="text-xs text-slate-500">Archived</span>{onRestore ? <button className="button-secondary ml-auto" type="button" disabled={busy === `restore:${leg.id}`} onClick={async () => { setBusy(`restore:${leg.id}`); try { await onRestore(leg.id); } finally { setBusy(null); } }}>{busy === `restore:${leg.id}` ? "Restoring…" : "Restore"}</button> : null}</div>)}</div> : null}
    </section>
  );
}

