import { useState } from "react";
import type { FestivalCrewFact, FestivalCrewStopInput, FestivalStopCategory } from "@workspace/api-client-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { CATEGORIES, CATEGORY_LABELS } from "./crew-location-api";
import { confirmationLabel } from "@/lib/crew-confirmation";

const FACTS: FestivalCrewFact[] = ["unknown", "yes", "no"];
export function blankStop(): FestivalCrewStopInput {
  return { name: "", category: "rv_park", address: "", latitude: null, longitude: null, sourceKey: null, sourceUrl: "", phone: "", website: "", notes: "", rigFit: "unknown", hookups: "unknown", overnight: "unknown", rigFitConfirmedOn: null, hookupsConfirmedOn: null, overnightConfirmedOn: null, maxRigLengthFeet: null, expectedUpdatedAt: null };
}
export function FestivalCrewStopForm({ initial, busy, error, onSave, onCancel, onDirty }: {
  initial: FestivalCrewStopInput; busy: boolean; error: string | null;
  onSave(value: FestivalCrewStopInput): void; onCancel(): void; onDirty?(): void;
}) {
  const [v, setV] = useState({ ...initial, lat: initial.latitude == null ? "" : String(initial.latitude), lon: initial.longitude == null ? "" : String(initial.longitude), rig: initial.maxRigLengthFeet == null ? "" : String(initial.maxRigLengthFeet) });
  const [local, setLocal] = useState<string | null>(null);
  const set = (patch: Partial<typeof v>) => { setV(c => ({ ...c, ...patch })); onDirty?.(); };
  function submit() {
    const name = v.name.trim();
    if (!name) return setLocal("Name is required.");
    const hasLat = v.lat.trim() !== "", hasLon = v.lon.trim() !== "";
    if (hasLat !== hasLon) return setLocal("Enter both latitude and longitude, or leave both blank.");
    const latitude = hasLat ? Number(v.lat) : null, longitude = hasLon ? Number(v.lon) : null;
    if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) return setLocal("Latitude must be between -90 and 90.");
    if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return setLocal("Longitude must be between -180 and 180.");
    const rigText = v.rig.trim();
    const rig = rigText ? Number(rigText) : null;
    if (rig != null && (!Number.isInteger(rig) || rig < 1 || rig > 150)) return setLocal("Max rig length must be a whole number from 1 to 150 feet.");
    setLocal(null);
    const { lat: _a, lon: _b, rig: _c, ...rest } = v;
    onSave({ ...rest, name, latitude, longitude, maxRigLengthFeet: rig });
  }
  const fact = (label: string, key: "rigFit" | "hookups" | "overnight") => {
    const field = `${key}ConfirmedOn` as "rigFitConfirmedOn" | "hookupsConfirmedOn" | "overnightConfirmedOn";
    return (
    <div className="grid gap-1"><Label htmlFor={`stop-${key}`}>{label}</Label>
      <Select disabled={busy} value={v[key]} onValueChange={x => set({ [key]: x as FestivalCrewFact, [field]: null })}><SelectTrigger id={`stop-${key}`}><SelectValue /></SelectTrigger>
        <SelectContent>{FACTS.map(f => <SelectItem key={f} value={f}>{f === "unknown" ? "Unknown" : f === "yes" ? "Yes" : "No"}</SelectItem>)}</SelectContent></Select>
      <Label htmlFor={`stop-${field}`}>{label} staff-confirmed date</Label>
      <Input id={`stop-${field}`} type="date" disabled={busy || v[key] === "unknown"} value={v[field] ?? ""} max={new Date().toLocaleDateString("en-CA")} onChange={e => set({ [field]: e.target.value || null })} />
      <p className="text-xs text-muted-foreground">{confirmationLabel(v[key], v[field])}</p>
    </div>);
  };
  const text = (id: string, label: string, key: "name" | "address" | "phone" | "website" | "lat" | "lon" | "rig") => (
    <div className="grid gap-1"><Label htmlFor={`stop-${id}`}>{label}</Label><Input disabled={busy} id={`stop-${id}`} value={v[key]} onChange={e => set({ [key]: e.target.value, ...(key === "rig" ? { rigFitConfirmedOn: null } : {}) })} /></div>);
  const shown = local ?? error;
  return <form className="grid gap-3 rounded-md border border-border bg-muted p-3" onSubmit={e => { e.preventDefault(); submit(); }} aria-label="Crew stop details">
    <p className="text-xs text-muted-foreground">Facts below are staff-reported. Leave them unknown until someone confirms with the place. Enter the date staff checked each fact; source lookups do not count. Never assume Walmart allows overnight parking.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {text("name", "Name", "name")}
      <div className="grid gap-1"><Label htmlFor="stop-category">Category</Label>
        <Select disabled={busy} value={v.category} onValueChange={x => set({ category: x as FestivalStopCategory })}><SelectTrigger id="stop-category"><SelectValue /></SelectTrigger>
          <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent></Select></div>
      {text("address", "Address", "address")}{text("phone", "Phone", "phone")}
      {text("lat", "Latitude (optional)", "lat")}{text("lon", "Longitude (optional)", "lon")}
      {text("website", "Website", "website")}{text("rig", "Max rig length (feet)", "rig")}
      {fact("Rig fit", "rigFit")}{fact("Hookups", "hookups")}{fact("Overnight parking", "overnight")}
    </div>
    <div className="grid gap-1"><Label htmlFor="stop-notes">Notes</Label><Textarea disabled={busy} id="stop-notes" value={v.notes} onChange={e => set({ notes: e.target.value })} /></div>
    {shown ? <p role="alert" className="text-sm text-destructive">{shown}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : initial.expectedUpdatedAt ? "Save changes" : "Save crew stop"}</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </form>;
}
