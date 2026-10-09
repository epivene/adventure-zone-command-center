import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FestivalCrewLocation, FestivalCrewStop, FestivalCrewStopInput, FestivalNearbySuggestion, FestivalStopCategory, FestivalVenuePin } from "@workspace/api-client-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@workspace/avz-crm/components/ui/alert-dialog";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { CATEGORIES, CATEGORY_LABELS, crewApi, directionsUrl, safeUrl, suggestionToInput } from "./crew-location-api";
import { FestivalCrewMap, type CrewMapPoint } from "./festival-crew-map";
import { blankStop, FestivalCrewStopForm } from "./festival-crew-stop-form";

type Editing = { stop: FestivalCrewStop | null; initial: FestivalCrewStopInput } | null;
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const date = (v: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(v));
const factText = (label: string, v: string) => `${label}: ${v === "yes" ? "Yes" : v === "no" ? "No" : "Unknown"}`;

function Links({ s }: { s: { latitude: number | null; longitude: number | null; address: string; website: string; sourceUrl: string } }) {
  const dir = directionsUrl(s), web = safeUrl(s.website), src = safeUrl(s.sourceUrl);
  return <div className="flex flex-wrap gap-3 text-sm">
    {dir ? <a className="text-primary underline underline-offset-4" href={dir} target="_blank" rel="noopener noreferrer">Directions</a> : null}
    {web ? <a className="text-primary underline underline-offset-4" href={web} target="_blank" rel="noopener noreferrer">Website</a> : null}
    {src ? <a className="text-primary underline underline-offset-4" href={src} target="_blank" rel="noopener noreferrer">OpenStreetMap listing</a> : null}
  </div>;
}

export function FestivalCrewLocation({ organizationId, year, onEditionChanged, onEditingChange, onEditEvent }: {
  organizationId: string; year: number; onEditionChanged: () => void; onEditingChange?: (editing: boolean) => void; onEditEvent?: () => void;
}) {
  const [data, setData] = useState<FestivalCrewLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<FestivalVenuePin[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [manual, setManual] = useState({ lat: "", lon: "", label: "" });
  const [pinOpen, setPinOpen] = useState(false);
  const [radius, setRadius] = useState<10 | 25 | 50>(25);
  const [category, setCategory] = useState<FestivalStopCategory>("rv_park");
  const [nearby, setNearby] = useState<{ items: FestivalNearbySuggestion[]; searchedAt: string; radius: number } | null>(null);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FestivalCrewStop | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const gen = useRef(0);
  const dirty = useRef(false);
  const cbRef = useRef(onEditingChange); cbRef.current = onEditingChange;
  const changedRef = useRef(onEditionChanged); changedRef.current = onEditionChanged;
  useEffect(() => { cbRef.current?.(Boolean(editing) || writing || pinOpen || lookupBusy || nearbyBusy); }, [editing, writing, pinOpen, lookupBusy, nearbyBusy]);
  useEffect(() => () => cbRef.current?.(false), []);

  const load = useCallback(async () => {
    const read = ++gen.current;
    try {
      const v = await crewApi.get(organizationId, year);
      if (read !== gen.current) return;
      setData(v); setLoadError(null); setQuery(q => q || v.venue);
    } catch (e) { if (read === gen.current) setLoadError(msg(e)); }
    finally { if (read === gen.current) setLoading(false); }
  }, [organizationId, year]);
  useEffect(() => {
    void load();
    const refresh = () => { if (!document.hidden && !dirty.current) void load(); };
    window.addEventListener("focus", refresh);
    return () => { gen.current++; window.removeEventListener("focus", refresh); };
  }, [load]);

  const venue = data?.venue?.trim() ?? "";
  const pin = data?.location ?? null;
  const pinKey = pin ? `${pin.latitude}:${pin.longitude}` : "";
  const currentPinKey = useRef(pinKey);
  currentPinKey.current = pinKey;
  useEffect(() => { setNearby(null); setNearbyError(null); }, [pinKey]);
  const stops = data?.stops ?? [];
  const savedKeys = new Set(stops.map(s => s.sourceKey).filter(Boolean));
  const visible = useMemo(() => (nearby?.items ?? []).filter(s => s.category === category).sort((a, b) => a.distanceMiles - b.distanceMiles), [nearby, category]);
  const points = useMemo<CrewMapPoint[]>(() => [
    ...(pin ? [{ id: "venue", name: pin.displayName || venue, latitude: pin.latitude, longitude: pin.longitude, kind: "venue" as const }] : []),
    ...stops.filter(s => s.latitude != null && s.longitude != null).map(s => ({ id: s.id, name: s.name, latitude: s.latitude as number, longitude: s.longitude as number, kind: "saved" as const })),
    ...visible.filter(s => !savedKeys.has(s.sourceKey)).map(s => ({ id: s.sourceKey, name: s.name, latitude: s.latitude, longitude: s.longitude, kind: "suggested" as const })),
  ], [pin, venue, stops, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup() {
    const q = query.trim();
    if (q.length < 3) return setLookupError("Enter at least 3 characters.");
    const read = gen.current; setLookupBusy(true); setLookupError(null);
    try { const r = await crewApi.searchVenue(organizationId, year, q); if (read === gen.current) setCandidates(r.candidates); }
    catch (e) { if (read === gen.current) setLookupError(`${msg(e)} You can enter coordinates manually below.`); }
    finally { setLookupBusy(false); }
  }
  async function confirmPin(p: FestivalVenuePin) {
    if (!data?.editionUpdatedAt) return;
    setWriting(true); setActionError(null);
    try { const v = await crewApi.savePin(organizationId, year, p, data.editionUpdatedAt); setData(v); setCandidates(null); setPinOpen(false); setNotice("Venue pin saved."); changedRef.current(); }
    catch (e) { setActionError(msg(e)); await load(); }
    finally { setWriting(false); }
  }
  function confirmManual() {
    const latitude = Number(manual.lat), longitude = Number(manual.lon);
    if (manual.lat.trim() === "" || manual.lon.trim() === "" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return setActionError("Enter valid latitude (-90 to 90) and longitude (-180 to 180).");
    void confirmPin({ latitude, longitude, displayName: manual.label.trim() || venue });
  }
  async function searchNearby() {
    const read = gen.current, searchedPin = pinKey; setNearbyBusy(true); setNearbyError(null);
    try { const r = await crewApi.nearby(organizationId, year, radius); if (read === gen.current && searchedPin === currentPinKey.current) setNearby({ items: r.suggestions, searchedAt: r.searchedAt, radius: r.radiusMiles }); }
    catch (e) { if (read === gen.current) setNearbyError(msg(e)); }
    finally { setNearbyBusy(false); }
  }
  function startEdit(e: Editing) { dirty.current = false; setFormError(null); setEditing(e); }
  function closeEdit() { dirty.current = false; setEditing(null); setFormError(null); }
  async function saveStop(input: FestivalCrewStopInput) {
    if (!editing) return;
    setWriting(true); setFormError(null);
    try {
      const saved = editing.stop
        ? await crewApi.updateStop(organizationId, year, editing.stop.id, { ...input, expectedUpdatedAt: editing.stop.updatedAt })
        : await crewApi.createStop(organizationId, year, { ...input, expectedUpdatedAt: null });
      setData(current => current ? { ...current, stops: [...current.stops.filter(stop => stop.id !== saved.id), saved] } : current);
      closeEdit(); setNotice("Crew stop saved."); await load();
    } catch (e) { setFormError(msg(e)); }
    finally { setWriting(false); }
  }
  async function removeStop() {
    if (!removing) return;
    const target = removing; setWriting(true); setActionError(null);
    try { await crewApi.removeStop(organizationId, year, target.id, target.updatedAt); setData(current => current ? { ...current, stops: current.stops.filter(stop => stop.id !== target.id) } : current); setRemoving(null); setNotice("Crew stop removed."); await load(); }
    catch (e) { setActionError(msg(e)); setRemoving(null); }
    finally { setWriting(false); }
  }

  const showForm = editing ? <FestivalCrewStopForm key={editing.stop?.id ?? "new"} initial={editing.initial} busy={writing} error={formError} onSave={s => void saveStop(s)} onCancel={closeEdit} onDirty={() => { dirty.current = true; }} /> : null;

  return <Card aria-label="Location and nearby stops">
    <CardHeader className="flex-col items-stretch gap-1 space-y-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Crew travel · {year}</p>
      <CardTitle>Location &amp; nearby stops</CardTitle>
    </CardHeader>
    <CardContent className="grid gap-4">
      {loading ? <div className="grid gap-2" role="status" aria-label="Loading location"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-16 w-full" /></div>
      : loadError && !data ? <div role="alert" className="grid gap-2"><p className="text-sm text-destructive">{loadError}</p><Button className="w-fit" variant="outline" size="sm" onClick={() => { setLoading(true); void load(); }}>Retry</Button></div>
      : <>
        {loadError ? <p role="alert" className="text-sm text-destructive">Could not refresh: {loadError}</p> : null}
        {notice ? <p role="status" className="text-sm font-semibold text-primary">{notice}</p> : null}
        {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}

        <div className="grid gap-2 rounded-md border border-border bg-muted p-3">
          <p className="text-xs font-semibold text-muted-foreground">Annual venue</p>
          {!venue ? <>
            <p className="text-sm">Add a venue to the {year} event details first. The organizer address is not used.</p>
            {onEditEvent ? <Button disabled={Boolean(editing) || writing} className="w-fit" variant="outline" size="sm" onClick={onEditEvent}>Edit event details</Button> : <p className="text-sm text-muted-foreground">Use Edit event details above.</p>}
          </> : <>
            <p className="break-words text-sm font-semibold">{venue}</p>
            <p className="break-words text-sm text-muted-foreground">{pin ? `Pin: ${pin.displayName} (${pin.latitude.toFixed(4)}, ${pin.longitude.toFixed(4)})` : "No venue pin confirmed yet."}</p>
            {!pinOpen ? <Button className="w-fit" variant="outline" size="sm" onClick={() => setPinOpen(true)}>{pin ? "Change venue pin" : "Find venue on map"}</Button> : <div className="grid gap-3">
              <div className="grid gap-1"><Label htmlFor="crew-venue-query">Address or place to look up</Label>
                <div className="flex flex-col gap-2 sm:flex-row"><Input id="crew-venue-query" value={query} onChange={e => setQuery(e.target.value)} maxLength={400} />
                  <Button className="shrink-0" size="sm" disabled={lookupBusy || writing} onClick={() => void lookup()}>{lookupBusy ? "Searching…" : "Search"}</Button></div></div>
              {lookupError ? <p role="alert" className="text-sm text-destructive">{lookupError}</p> : null}
              {candidates && !candidates.length ? <p className="text-sm text-muted-foreground">No matches found. Refine the search or enter coordinates.</p> : null}
              {candidates?.map((c, i) => <div key={`${c.latitude},${c.longitude},${i}`} className="flex flex-col gap-2 rounded-md border border-border bg-card p-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 break-words text-sm">{c.displayName}</p><Button className="shrink-0" size="sm" disabled={writing} onClick={() => void confirmPin(c)}>Confirm this pin</Button></div>)}
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-1"><Label htmlFor="crew-man-lat">Latitude</Label><Input id="crew-man-lat" inputMode="decimal" value={manual.lat} onChange={e => setManual({ ...manual, lat: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="crew-man-lon">Longitude</Label><Input id="crew-man-lon" inputMode="decimal" value={manual.lon} onChange={e => setManual({ ...manual, lon: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="crew-man-label">Label</Label><Input id="crew-man-label" value={manual.label} onChange={e => setManual({ ...manual, label: e.target.value })} /></div>
              </div>
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={writing} onClick={confirmManual}>Confirm coordinates</Button><Button size="sm" variant="ghost" disabled={writing} onClick={() => setPinOpen(false)}>Close</Button></div>
              <p className="text-xs text-muted-foreground">Confirming a pin does not change the venue text in event details.</p>
            </div>}
          </>}
        </div>

        {pin && points.length ? <div className="grid gap-2">
          {mapOpen ? <FestivalCrewMap points={points} /> : null}
          <div className="flex flex-wrap items-center gap-3"><Button className="w-fit" variant="outline" size="sm" onClick={() => setMapOpen(o => !o)}>{mapOpen ? "Hide map" : "Show map"}</Button>
            {mapOpen ? <p className="text-xs text-muted-foreground">Dark: venue · Magenta: saved stops · Yellow: suggestions</p> : null}</div>
        </div> : null}

        <section className="grid gap-2" aria-label="Saved crew stops">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Saved crew stops ({stops.length})</h3>
            {!editing ? <Button variant="outline" size="sm" onClick={() => startEdit({ stop: null, initial: blankStop() })}>Add crew stop</Button> : null}</div>
          {editing && !editing.stop ? showForm : null}
          {!stops.length && !editing ? <p className="text-sm text-muted-foreground">No crew stops saved for {year}. Save a suggestion below or add one yourself.</p> : null}
          {stops.map(s => editing?.stop?.id === s.id ? <div key={s.id}>{showForm}</div> : <div key={s.id} className="grid gap-1 rounded-md border border-primary bg-card p-3">
            <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{s.name}</p><Badge variant="outline">{CATEGORY_LABELS[s.category]}</Badge></div>
            {s.address ? <p className="break-words text-sm text-muted-foreground">{s.address}</p> : null}
            {s.phone ? <p className="text-sm">{s.phone}</p> : null}
            <p className="text-xs text-muted-foreground">Staff-reported {date(s.updatedAt)}: {[factText("Rig fit", s.rigFit), factText("Hookups", s.hookups), factText("Overnight", s.overnight)].join(" · ")}{s.maxRigLengthFeet ? ` · Max rig ${s.maxRigLengthFeet} ft` : ""}</p>
            {s.category === "walmart" && s.overnight !== "yes" ? <p className="text-xs text-destructive">Call this store and get explicit permission before parking overnight.</p> : null}
            {s.notes ? <p className="whitespace-pre-line break-words text-sm">{s.notes}</p> : null}
            <Links s={s} />
            <div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="outline" disabled={writing || Boolean(editing)} onClick={() => startEdit({ stop: s, initial: { ...s, expectedUpdatedAt: s.updatedAt } })}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={writing || Boolean(editing)} onClick={() => setRemoving(s)}>Remove</Button></div>
          </div>)}
        </section>

        <section className="grid gap-3 rounded-md border border-dashed border-border p-3" aria-label="Nearby suggestions">
          <h3 className="text-sm font-semibold">Nearby suggestions</h3>
          {!pin ? <p className="text-sm text-muted-foreground">Confirm a venue pin to search nearby.</p> : <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1"><Label>Radius</Label><Select value={String(radius)} onValueChange={v => setRadius(Number(v) as 10 | 25 | 50)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{[10, 25, 50].map(r => <SelectItem key={r} value={String(r)}>{r} miles</SelectItem>)}</SelectContent></Select></div>
              <div className="grid gap-1"><Label>Show</Label><Select value={category} onValueChange={v => setCategory(v as FestivalStopCategory)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent></Select></div>
              <Button size="sm" disabled={nearbyBusy} onClick={() => void searchNearby()}>{nearbyBusy ? "Searching…" : nearby ? "Search again" : "Search nearby"}</Button>
            </div>
            {nearbyError ? <div role="alert" className="grid gap-1"><p className="text-sm text-destructive">Nearby search failed: {nearbyError}</p></div> : null}
            {nearby ? <>
              <p className="text-xs text-muted-foreground">Within {nearby.radius} miles, searched {date(nearby.searchedAt)}. Distances are straight-line miles, not drive miles. Listings come from OpenStreetMap contributors and are unverified: hookups, rig fit and overnight parking are not known.</p>
              {!visible.length ? <p className="text-sm text-muted-foreground">{nearby.items.length ? `No ${CATEGORY_LABELS[category].toLowerCase()} in these results. Try another category.` : "The provider returned no listings in this radius."}</p> : null}
              {visible.map(s => <div key={s.sourceKey} className="grid gap-1 rounded-md border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{s.name}</p><Badge variant="secondary">{s.distanceMiles.toFixed(1)} mi straight-line</Badge><Badge variant="outline">Unverified</Badge></div>
                {s.address ? <p className="break-words text-sm text-muted-foreground">{s.address}</p> : null}
                {s.category === "walmart" ? <p className="text-xs text-destructive">Call the store for explicit overnight permission.</p> : null}
                <Links s={{ ...s }} />
                <div className="pt-1">{savedKeys.has(s.sourceKey) ? <Badge variant="outline">Saved</Badge> : <Button size="sm" variant="outline" disabled={writing || Boolean(editing)} onClick={() => startEdit({ stop: null, initial: suggestionToInput(s) })}>Save as crew stop</Button>}</div>
              </div>)}
              <p className="text-xs text-muted-foreground">Data &copy; <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors.</p>
            </> : <p className="text-xs text-muted-foreground">Nothing is searched until you click. Results stay on this screen and are not saved.</p>}
          </>}
        </section>
      </>}
    </CardContent>
    <AlertDialog open={Boolean(removing)} onOpenChange={o => { if (!o && !writing) setRemoving(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove crew stop?</AlertDialogTitle>
        <AlertDialogDescription>Removes {removing?.name} from this year's saved stops only. The source listing and the profile are not changed.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={writing}>Keep stop</AlertDialogCancel><AlertDialogAction disabled={writing} onClick={e => { e.preventDefault(); void removeStop(); }}>{writing ? "Removing…" : "Remove"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </Card>;
}
