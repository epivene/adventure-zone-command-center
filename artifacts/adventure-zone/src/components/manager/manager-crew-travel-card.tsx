import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { FestivalCrewMap, type CrewMapPoint } from "@/components/profiles/festival-crew-map";
import { CATEGORY_LABELS, crewApi, directionsUrl, safeUrl, type ManagerCrewLocationResponse } from "@/components/profiles/crew-location-api";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { crewCacheEpoch, getCrewSnapshot, removeCrewSnapshot, saveCrewSnapshot } from "@/lib/manager-crew-cache";

type Stop = NonNullable<ManagerCrewLocationResponse["crewLocation"]>["stops"][number];
const fact = (v: string) => (v === "yes" ? "Yes" : v === "no" ? "No" : "Unknown");

function StopRow({ stop }: { stop: Stop }) {
  const source = safeUrl(stop.sourceUrl), site = safeUrl(stop.website), dir = directionsUrl(stop);
  return (
    <li className="grid gap-2 rounded-md border border-border p-3" data-testid={`crew-stop-${stop.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold">{stop.name}</p>
        <Badge variant="outline">{CATEGORY_LABELS[stop.category] ?? stop.category}</Badge>
      </div>
      {stop.address ? <p className="text-sm text-muted-foreground">{stop.address}</p> : null}
      {stop.latitude != null && stop.longitude != null ? <p className="text-sm">Directions destination: {stop.latitude}, {stop.longitude}</p> : null}
      {stop.phone ? <p className="text-sm">Phone: {stop.phone}</p> : null}
      <p className="text-sm font-semibold">Saved staff notes</p>
      <p className="whitespace-pre-wrap break-words text-sm">{stop.notes || "No notes saved."}</p>
      <dl className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Rig fit</dt><dd>{fact(stop.rigFit)}</dd></div>
        <div><dt className="text-muted-foreground">Hookups</dt><dd>{fact(stop.hookups)}</dd></div>
        <div><dt className="text-muted-foreground">Overnight allowed</dt><dd>{fact(stop.overnight)}</dd></div>
        <div><dt className="text-muted-foreground">Max rig length</dt><dd>{stop.maxRigLengthFeet != null ? `${stop.maxRigLengthFeet} ft` : "Unknown"}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-3 text-sm">
        {dir ? <a className="text-primary underline" href={dir} target="_blank" rel="noopener noreferrer">Directions</a> : null}
        {site ? <a className="text-primary underline" href={site} target="_blank" rel="noopener noreferrer">Website</a> : null}
        {source ? <a className="text-primary underline" href={source} target="_blank" rel="noopener noreferrer">Source listing (not verified by staff)</a> : null}
      </div>
    </li>
  );
}

export function ManagerCrewTravelCard({ bookingId }: { bookingId: string }) {
  const { managerApi, manager } = useManagerAuth();
  const legId = manager?.legId;
  const [offline, setOffline] = useState(!navigator.onLine);
  const [state, setState] = useState<{ status: "loading" | "error" | "ready"; data: ManagerCrewLocationResponse | null; error: string; loadedAt?: string; stale?: boolean; scope?: string }>({ status: "loading", data: null, error: "" });
  const scope = `${legId}:${bookingId}`;
  const latest = useRef(0);
  const load = useCallback(async () => {
    const id = ++latest.current;
    const epoch = legId ? crewCacheEpoch(legId) : 0;
    setState({ status: "loading", data: null, error: "" });
    try {
      if (!navigator.onLine) throw new TypeError("Offline");
      const data = await crewApi.getForManager(bookingId, managerApi);
      if (id !== latest.current || (legId && epoch !== crewCacheEpoch(legId))) return;
      if (data.bookingId !== bookingId) throw new Error("Crew response does not match this event");
      const loadedAt = new Date().toISOString();
      const saved = legId ? await saveCrewSnapshot(legId, data, epoch).catch(() => null) : null;
      if (id === latest.current && (!legId || epoch === crewCacheEpoch(legId))) setState({ status: "ready", data, error: saved || !legId ? "" : "Private storage unavailable; this load is not saved for offline use.", loadedAt, scope });
    } catch (e) {
      const status = typeof e === "object" && e && "status" in e ? Number(e.status) : null;
      if (status === 401 || status === 403 || status === 404) {
        if (legId) await removeCrewSnapshot(legId, bookingId).catch(() => undefined);
      }
      // Only connectivity failures may disclose previously authorized snapshots.
      const cached = legId && status == null && (e instanceof TypeError || !navigator.onLine)
        ? await getCrewSnapshot(legId, bookingId).catch(() => null) : null;
      if (id !== latest.current || (legId && epoch !== crewCacheEpoch(legId))) return;
      if (cached) setState({ status: "ready", data: cached.data, loadedAt: cached.loadedAt, stale: true, error: "", scope });
      else setState({ status: "error", data: null, error: !navigator.onLine ? "Offline. No previously loaded crew directions are saved for this event." : e instanceof Error ? e.message : "Request failed", scope });
    }
  }, [bookingId, managerApi, legId, scope]);
  useEffect(() => {
    const reconnect = () => { setOffline(!navigator.onLine); void load(); };
    const disconnect = () => setOffline(true);
    const revoked = (event: Event) => {
      const detail = (event as CustomEvent<{ legId: string; bookingIds: string[] }>).detail;
      if (detail.legId === legId && !detail.bookingIds.includes(bookingId)) {
        latest.current++;
        setState({ status: "error", data: null, error: "This event is no longer assigned to your leg. Saved crew travel has been removed.", scope });
      }
    };
    void load();
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", disconnect);
    window.addEventListener("focus", reconnect);
    window.addEventListener("manager-crew-assignments", revoked);
    return () => { latest.current++; window.removeEventListener("online", reconnect); window.removeEventListener("offline", disconnect); window.removeEventListener("focus", reconnect); window.removeEventListener("manager-crew-assignments", revoked); };
  }, [load, legId, bookingId, scope]);

  const { status } = state;
  const data = state.scope === scope ? state.data : null;
  const crew = data?.crewLocation ?? null;
  const points: CrewMapPoint[] = crew ? [
    ...(crew.location ? [{ id: "venue", name: crew.venue, latitude: crew.location.latitude, longitude: crew.location.longitude, kind: "venue" as const }] : []),
    ...crew.stops.filter(s => s.latitude != null && s.longitude != null).map(s => ({ id: s.id, name: s.name, latitude: s.latitude as number, longitude: s.longitude as number, kind: "saved" as const })),
  ] : [];
  let body;
  if (status === "loading") body = <div className="grid gap-2" role="status" aria-label="Loading crew travel"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /></div>;
  else if (status === "error") body = <div role="alert" className="grid gap-2 text-sm"><p className="text-destructive">{state.error}</p><div><Button variant="outline" onClick={load}>Retry</Button></div></div>;
  else if (!crew) {
    const msg = data?.year == null ? "This event has no linked festival profile or season year, so no crew travel is available." : `No saved crew travel for the ${data.year} season.`;
    body = <p className="text-sm text-muted-foreground" data-testid="crew-empty">{msg}</p>;
  } else body = (
    <div className="grid gap-3">
      {state.loadedAt ? <p className="text-sm text-muted-foreground">Last loaded: {new Date(state.loadedAt).toLocaleString()}</p> : null}
      {offline || state.stale ? <p role="alert" className="rounded-md border border-border bg-muted p-3 text-sm">Offline / stale saved copy. Assignments, venue pins and staff notes may have changed. Reconnect to verify access and refresh. Maps and external directions need a connection; use the saved addresses, coordinates and notes below.</p> : null}
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <p className="text-sm">Annual venue{data?.year ? ` · ${data.year}` : ""}: <span className="font-semibold">{crew.venue || "Not recorded for this event year."}</span></p>
      <p className="text-sm text-muted-foreground">Read-only saved staff records. Source listings do not confirm rig suitability or overnight permission.</p>
      {crew.location ? <div className="grid gap-1 text-sm">
        <p>Confirmed pin: {crew.location.displayName} ({crew.location.latitude.toFixed(4)}, {crew.location.longitude.toFixed(4)})</p>
        <a className="text-primary underline" href={directionsUrl({ ...crew.location, address: crew.venue })!} target="_blank" rel="noopener noreferrer">Venue directions</a>
      </div> : <p className="text-sm text-muted-foreground">No venue pin confirmed for this year. The organizer address is not used.</p>}
      {points.length && !offline ? <FestivalCrewMap points={points} /> : null}
      {crew.stops.length ? <ul className="grid gap-2" aria-label="Saved crew stops">{crew.stops.map(s => <StopRow key={s.id} stop={s} />)}</ul> : <p className="text-sm text-muted-foreground" data-testid="crew-empty">No crew stops saved yet.</p>}
    </div>
  );
  return (
    <Card aria-label="Saved crew travel" data-testid="card-crew-travel">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">Saved crew travel</CardTitle>
        <Button variant="outline" onClick={load} disabled={status === "loading"} data-testid="button-reload-crew">Reload</Button>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
