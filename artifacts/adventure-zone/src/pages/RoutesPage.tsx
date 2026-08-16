import { useEffect, useState } from "react";
import { apiFetch, apiGet, apiPut } from "@/lib/auth-token";
import { EventMap } from "@/components/routes/event-map";
import type { FocusedTripMapData } from "@/components/routes/manager-route-map-layers";
import { EquipmentHandoffs, type EquipmentHandoffView } from "@/components/routes/equipment-handoffs";
import type { LegManagerAccessStatus } from "@/components/routes/travel-leg-editor";
import { TravelLegManagerCards } from "@/components/routes/travel-leg-manager-cards";
import { TripsSection } from "@/components/routes/trips-section";
import { AdminMapViewToggle, type AdminMapView } from "@/components/routes/admin-map-view-toggle";
import { ManagerPreviewMap } from "@/components/routes/manager-preview-map";
import { ManagerRouteReviewQueue } from "@/components/routes/manager-route-review-queue";
import {
  updateTravelLegAction,
  reorderTravelLegsAction,
  addTravelLegAction,
  archiveTravelLegAction,
  restoreTravelLegAction,
} from "@/actions/routes";
import type { TravelLegDetails, TravelLegOrder } from "@/features/routes/travel-leg-input";

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

export default function RoutesPage() {
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
  async function handleSetManagerPassword(legId: string, password: string) { await apiPut(`/manager-admin/legs/${legId}/access`, { password }); await loadData(); }
  async function handleSignOutManagerDevices(legId: string) { const response = await apiFetch(`/manager-admin/legs/${legId}/sign-out-all`, { method: "POST", body: "{}" }); if (!response.ok) throw new Error("Could not sign out manager devices"); await loadData(); }
  async function handleAdd() { const result = await addTravelLegAction(); if (!result.ok) throw new Error(result.error); await loadData(); }
  async function handleArchive(id: string) { const result = await archiveTravelLegAction(id); if (!result.ok) throw new Error(result.error); await loadData(); }
  async function handleRestore(id: string) { const result = await restoreTravelLegAction(id); if (!result.ok) throw new Error(result.error); await loadData(); }
  async function handleFocusTrip(tripId: string) { const detail = await apiGet<TripFocusDetail>(`/trips/${tripId}`); setFocusedTrip(focusedTripMapData(detail)); }

  const focusedTripCoordinates = focusedTrip?.points.map((point) => [point.longitude, point.latitude] as [number, number]) ?? null;
  const activeLegs = data?.travelLegs?.filter((leg: any) => !leg.archivedAt) ?? [];

  return <div className="mx-auto grid max-w-7xl gap-6">
    <header><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Travel overview</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Routes</h1><p className="mt-2 max-w-2xl text-slate-600">Plan active and potential routes, historical seasons, and equipment movement across travel legs.</p></header>
    {loading ? <p className="text-slate-500">Loading routes…</p> : error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : data ? <>
      <TravelLegManagerCards key={data.travelLegs.map((leg: any) => `${leg.id}:${leg.archivedAt ? "a" : ""}`).sort().join(",")} legs={data.travelLegs} legResources={data.legResources} managerAccess={data.managerAccess} onSaveLeg={handleSaveLeg} onSaveOrder={handleSaveOrder} onSetManagerPassword={handleSetManagerPassword} onSignOutManagerDevices={handleSignOutManagerDevices} onAdd={handleAdd} onArchive={handleArchive} onRestore={handleRestore} />
      <ManagerRouteReviewQueue onApproved={loadData} />
      <a className="rounded-xl border bg-white p-4 font-semibold" href="/manager-finance">View all leg finances →</a>
      <div className="grid gap-2 sm:grid-cols-2"><a className="rounded-xl border bg-white p-4 font-semibold" href="/manager-crew">Seasonal crew →</a><a className="rounded-xl border bg-white p-4 font-semibold" href="/manager-aftermath">Reviews & incidents →</a></div>
      <TripsSection travelLegs={data.travelLegs} onFocusTrip={(tripId) => { void handleFocusTrip(tripId); }} />
      <EquipmentHandoffs travelLegs={data.travelLegs} resources={data.legResources} onChange={setHandoffs} />
      <section aria-labelledby="event-map-title" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold" id="event-map-title">Event map</h2><p className="mt-1 text-sm text-slate-600">Use Admin view for organization-wide planning, or preview exactly what one manager sees.</p></div><AdminMapViewToggle view={mapView} onChange={setMapView} /></div>
        {mapView === "manager-preview" ? <div className="grid gap-3"><label className="grid max-w-sm gap-1 text-sm font-semibold">Preview manager<select aria-label="Preview manager" value={previewLegId} onChange={(event) => setPreviewLegId(event.target.value)}>{activeLegs.map((leg: any) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label><ManagerPreviewMap legId={previewLegId} /></div> : <EventMap events={data.events} travelLegs={data.travelLegs} handoffs={handoffs} focusedTrip={focusedTrip} focusedTripCoordinates={focusedTripCoordinates} onClearTripFocus={() => setFocusedTrip(null)} />}
      </section>
    </> : null}
  </div>;
}