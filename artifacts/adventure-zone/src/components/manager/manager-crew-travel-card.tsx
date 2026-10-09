import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { FestivalCrewMap, type CrewMapPoint } from "@/components/profiles/festival-crew-map";
import { CATEGORY_LABELS, crewApi, directionsUrl, safeUrl, type ManagerCrewLocationResponse } from "@/components/profiles/crew-location-api";
import { useManagerAuth } from "@/lib/manager-auth-context";

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
  const { managerApi } = useManagerAuth();
  const [state, setState] = useState<{ status: "loading" | "error" | "ready"; data: ManagerCrewLocationResponse | null; error: string }>({ status: "loading", data: null, error: "" });
  const latest = useRef(0);
  const load = useCallback(() => {
    const id = ++latest.current;
    setState({ status: "loading", data: null, error: "" });
    crewApi.getForManager(bookingId, managerApi).then(
      data => { if (id === latest.current) setState({ status: "ready", data, error: "" }); },
      (e: unknown) => { if (id === latest.current) setState({ status: "error", data: null, error: e instanceof Error ? e.message : "Request failed" }); },
    );
  }, [bookingId, managerApi]);
  useEffect(() => { load(); return () => { latest.current++; }; }, [load]);

  const { status, data } = state;
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
      <p className="text-sm">Annual venue{data?.year ? ` · ${data.year}` : ""}: <span className="font-semibold">{crew.venue || "Not recorded for this event year."}</span></p>
      <p className="text-sm text-muted-foreground">Read-only saved staff records. Source listings do not confirm rig suitability or overnight permission.</p>
      {crew.location ? <div className="grid gap-1 text-sm">
        <p>Confirmed pin: {crew.location.displayName} ({crew.location.latitude.toFixed(4)}, {crew.location.longitude.toFixed(4)})</p>
        <a className="text-primary underline" href={directionsUrl({ ...crew.location, address: crew.venue })!} target="_blank" rel="noopener noreferrer">Venue directions</a>
      </div> : <p className="text-sm text-muted-foreground">No venue pin confirmed for this year. The organizer address is not used.</p>}
      {points.length ? <FestivalCrewMap points={points} /> : null}
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
