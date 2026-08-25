import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPut } from "@/lib/auth-token";
import { EventMap } from "@/components/routes/event-map";
import { RouteConflictWarning } from "@/components/routes/route-conflict-warning";
import type { FocusedTripMapData } from "@/components/routes/manager-route-map-layers";
import { EquipmentHandoffs, type EquipmentHandoffView } from "@/components/routes/equipment-handoffs";
import type { LegManagerAccessStatus } from "@/components/routes/travel-leg-editor";
import { TravelLegManagerCards } from "@/components/routes/travel-leg-manager-cards";
import { TripsSection } from "@/components/routes/trips-section";
import { AdminMapViewToggle, type AdminMapView } from "@/components/routes/admin-map-view-toggle";
import { ManagerPreviewMap } from "@/components/routes/manager-preview-map";
import { ManagerRouteReviewQueue } from "@/components/routes/manager-route-review-queue";
import { updateTravelLegAction, reorderTravelLegsAction, addTravelLegAction, archiveTravelLegAction, restoreTravelLegAction } from "@/actions/routes";
import type { TravelLegDetails, TravelLegOrder } from "@/features/routes/travel-leg-input";
import { findSameLegDateConflicts } from "@/features/routes/route-conflicts";

export type RouteScheduleFilters = { season?: string; legId?: string; status?: string; embedded?: boolean; managementOnly?: boolean };

type TripFocusDetail = {
  trip: { id: string; name: string; startLabel: string; startLatitude: number | null; startLongitude: number | null; endLabel: string; endLatitude: number | null; endLongitude: number | null };
  stops: Array<{ id: string; sortOrder: number; bookingName: string; city: string; region: string; latitude: number | null; longitude: number | null }>;
};

function focusedTripMapData(detail: TripFocusDetail): FocusedTripMapData {
  const points: FocusedTripMapData["points"] = [];
  if (detail.trip.startLatitude !== null && detail.trip.startLongitude !== null) points.push({ id: `start:${detail.trip.id}`, label: detail.trip.startLabel, latitude: detail.trip.startLatitude, longitude: detail.trip.startLongitude });
  for (const stop of [...detail.stops].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (stop.latitude === null || stop.longitude === null) continue;
    points.push({ id: stop.id, label: `${stop.bookingName} (${stop.city}, ${stop.region})`, latitude: stop.latitude, longitude: stop.longitude });
  }
  if (detail.trip.endLatitude !== null && detail.trip.endLongitude !== null) points.push({ id: `end:${detail.trip.id}`, label: detail.trip.endLabel, latitude: detail.trip.endLatitude, longitude: detail.trip.endLongitude });
  return { id: detail.trip.id, name: detail.trip.name, points };
}

export function RoutesContent({ season, legId, status, embedded = false, managementOnly = false }: RouteScheduleFilters) {
  const [data, setData] = useState<any>(null);
  const [handoffs, setHandoffs] = useState<EquipmentHandoffView[]>([]);
  const [focusedTrip, setFocusedTrip] = useState<FocusedTripMapData | null>(null);
  const [mapView, setMapView] = useState<AdminMapView>("admin");
  const [previewLegId, setPreviewLegId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadData() {
    return Promise.all([apiGet<any>("/routes"), apiGet<{ legs: LegManagerAccessStatus[] }>("/manager-admin/legs/access")])
      .then(([routes, access]) => {
        const next = {
          events: (routes.events ?? []).map((event: any) => ({ ...event, startsAt: event.startsAt ? new Date(event.startsAt) : null, endsAt: event.endsAt ? new Date(event.endsAt) : null })),
          travelLegs: routes.travelLegs ?? [], legResources: routes.legResources ?? [], managerAccess: access.legs ?? [],
        };
        setData(next);
        setPreviewLegId((current) => current || next.travelLegs.find((leg: any) => !leg.archivedAt)?.id || "");
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }

  useEffect(() => { void loadData(); }, []);

  async function handleSaveLeg(id: string, input: TravelLegDetails) {
    const result = await updateTravelLegAction(id, input);
    if (result.ok) setData((current: any) => ({ ...current, travelLegs: current.travelLegs.map((leg: any) => leg.id === id ? result.leg : leg), managerAccess: current.managerAccess.map((access: any) => access.legId === id ? { ...access, legName: result.leg.name } : access), events: current.events.map((event: any) => event.travelLegId === id ? { ...event, travelLegName: result.leg.name, travelLegColor: result.leg.color } : event) }));
    return result;
  }
  async function handleSaveOrder(input: TravelLegOrder) { const result = await reorderTravelLegsAction(input); if (result.ok) setData((current: any) => ({ ...current, travelLegs: result.legs })); return result; }
  async function handleSetManagerPassword(leg: string, password: string) { await apiPut(`/manager-admin/legs/${leg}/access`, { password }); await loadData(); }
  async function handleSignOutManagerDevices(leg: string) { const response = await apiFetch(`/manager-admin/legs/${leg}/sign-out-all`, { method: "POST", body: "{}" }); if (!response.ok) throw new Error("Could not sign out manager devices"); await loadData(); }
  async function handleAdd() { const result = await addTravelLegAction(); if (!result.ok) throw new Error(result.error); await loadData(); }
  async function handleArchive(id: string) { const result = await archiveTravelLegAction(id); if (!result.ok) throw new Error(result.error); await loadData(); }
  async function handleRestore(id: string) { const result = await restoreTravelLegAction(id); if (!result.ok) throw new Error(result.error); await loadData(); }
  async function handleFocusTrip(tripId: string) { const detail = await apiGet<TripFocusDetail>(`/trips/${tripId}`); setFocusedTrip(focusedTripMapData(detail)); }

  const focusedTripCoordinates = focusedTrip?.points.map((point) => [point.longitude, point.latitude] as [number, number]) ?? null;
  const activeLegs = data?.travelLegs?.filter((leg: any) => !leg.archivedAt) ?? [];
  const filteredEvents = useMemo(() => (data?.events ?? []).filter((event: any) => {
    if (legId && event.travelLegId !== legId) return false;
    if (status && status !== "all" && String(event.status ?? "").toLowerCase() !== status.toLowerCase()) return false;
    if (season && event.startsAt && new Date(event.startsAt).getFullYear().toString() !== season) return false;
    return true;
  }), [data?.events, legId, status, season]);
  const routeConflicts = useMemo(() => findSameLegDateConflicts(filteredEvents), [filteredEvents]);

  if (loading) return <p className="text-slate-500">Loading routes…</p>;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div>;
  if (!data) return null;

  const mapSection = (
    <section aria-labelledby="event-map-title" className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className={embedded ? "text-xl font-bold" : "text-2xl font-bold"} id="event-map-title">Route Map</h2><p className="mt-1 text-sm text-slate-600">Confirmed and potential route context across the selected season and leg.</p></div>
        <AdminMapViewToggle view={mapView} onChange={setMapView} />
      </div>
      <RouteConflictWarning conflicts={routeConflicts} />
      {mapView === "manager-preview" ? (
        <div className="grid gap-3"><label className="grid max-w-sm gap-1 text-sm font-semibold">Preview manager<select aria-label="Preview manager" value={previewLegId} onChange={(event) => setPreviewLegId(event.target.value)}>{activeLegs.map((leg: any) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label><ManagerPreviewMap legId={previewLegId} /></div>
      ) : <EventMap events={filteredEvents} travelLegs={data.travelLegs} handoffs={handoffs} focusedTrip={focusedTrip} focusedTripCoordinates={focusedTripCoordinates} onClearTripFocus={() => setFocusedTrip(null)} />}
    </section>
  );

  const planningSection = (
    <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" open={!embedded}>
      <summary className="cursor-pointer font-bold">Trips & route planning</summary>
      <div className="mt-4 grid gap-5"><TripsSection travelLegs={data.travelLegs} onFocusTrip={(tripId) => { void handleFocusTrip(tripId); }} /><EquipmentHandoffs travelLegs={data.travelLegs} resources={data.legResources} onChange={setHandoffs} /></div>
    </details>
  );

  const managementSection = (
    <section className="grid gap-5" aria-labelledby="leg-management-title">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Legs & Operations</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight" id="leg-management-title">Leg management</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Manage travel legs, ordering, resources, manager access, and route-review decisions.</p>
      </div>
      <div className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <TravelLegManagerCards key={data.travelLegs.map((leg: any) => `${leg.id}:${leg.archivedAt ? "a" : ""}`).sort().join(",")} legs={data.travelLegs} legResources={data.legResources} managerAccess={data.managerAccess} onSaveLeg={handleSaveLeg} onSaveOrder={handleSaveOrder} onSetManagerPassword={handleSetManagerPassword} onSignOutManagerDevices={handleSignOutManagerDevices} onAdd={handleAdd} onArchive={handleArchive} onRestore={handleRestore} />
        <ManagerRouteReviewQueue onApproved={loadData} />
        <div className="grid gap-2 sm:grid-cols-3"><a className="rounded-xl border bg-white p-4 font-semibold" href="/manager-finance">Leg finances →</a><a className="rounded-xl border bg-white p-4 font-semibold" href="/manager-crew">Seasonal crew →</a><a className="rounded-xl border bg-white p-4 font-semibold" href="/manager-aftermath">Reviews & incidents →</a></div>
      </div>
    </section>
  );

  return <div className="grid gap-5">
    {managementOnly ? managementSection : null}
    {!managementOnly && !embedded ? <header><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Travel overview</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Routes</h1><p className="mt-2 max-w-2xl text-slate-600">Plan active and potential routes, historical seasons, and equipment movement across travel legs.</p></header> : null}
    {!managementOnly ? mapSection : null}
    {!managementOnly ? planningSection : null}
    {!embedded && !managementOnly ? managementSection : null}
  </div>;
}

export function LegManagementPage() {
  return <div className="mx-auto max-w-7xl"><RoutesContent managementOnly /></div>;
}

export default function RoutesPage() {
  return <div className="mx-auto max-w-7xl"><RoutesContent /></div>;
}
