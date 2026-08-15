import { useEffect, useState } from "react";
import { apiFetch, apiGet, apiPut } from "@/lib/auth-token";
import { EventMap } from "@/components/routes/event-map";
import { EquipmentHandoffs, type EquipmentHandoffView } from "@/components/routes/equipment-handoffs";
import { TravelLegEditor, type LegManagerAccessStatus } from "@/components/routes/travel-leg-editor";
import { TripsSection } from "@/components/routes/trips-section";
import {
  updateTravelLegAction,
  reorderTravelLegsAction,
  addTravelLegAction,
  archiveTravelLegAction,
  restoreTravelLegAction,
} from "@/actions/routes";
import type { TravelLegDetails, TravelLegOrder } from "@/features/routes/travel-leg-input";

export default function RoutesPage() {
  const [data, setData] = useState<any>(null);
  const [handoffs, setHandoffs] = useState<EquipmentHandoffView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadData() {
    return Promise.all([
      apiGet<any>("/routes"),
      apiGet<{ legs: LegManagerAccessStatus[] }>("/manager-admin/legs/access"),
    ])
      .then(([routes, access]) => {
        setData({
          events: (routes.events ?? []).map((event: any) => ({
            ...event,
            startsAt: event.startsAt ? new Date(event.startsAt) : null,
            endsAt: event.endsAt ? new Date(event.endsAt) : null,
          })),
          travelLegs: routes.travelLegs ?? [],
          legResources: routes.legResources ?? [],
          managerAccess: access.legs ?? [],
        });
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }

  useEffect(() => { void loadData(); }, []);

  async function handleSaveLeg(id: string, input: TravelLegDetails) {
    const result = await updateTravelLegAction(id, input);
    if (result.ok) {
      setData((current: any) => ({
        ...current,
        travelLegs: current.travelLegs.map((leg: any) => leg.id === id ? result.leg : leg),
        managerAccess: current.managerAccess.map((access: any) =>
          access.legId === id ? { ...access, legName: result.leg.name } : access,
        ),
        events: current.events.map((event: any) =>
          event.travelLegId === id
            ? { ...event, travelLegName: result.leg.name, travelLegColor: result.leg.color }
            : event,
        ),
      }));
    }
    return result;
  }

  async function handleSaveOrder(input: TravelLegOrder) {
    const result = await reorderTravelLegsAction(input);
    if (result.ok) setData((current: any) => ({ ...current, travelLegs: result.legs }));
    return result;
  }

  async function handleSetManagerPassword(legId: string, password: string) {
    await apiPut(`/manager-admin/legs/${legId}/access`, { password });
    await loadData();
  }

  async function handleSignOutManagerDevices(legId: string) {
    const response = await apiFetch(`/manager-admin/legs/${legId}/sign-out-all`, {
      method: "POST",
      body: "{}",
    });
    if (!response.ok) throw new Error("Could not sign out manager devices");
    await loadData();
  }

  async function handleAdd() {
    const result = await addTravelLegAction();
    if (!result.ok) throw new Error(result.error);
    await loadData();
  }

  async function handleArchive(id: string) {
    const result = await archiveTravelLegAction(id);
    if (!result.ok) throw new Error(result.error);
    await loadData();
  }

  async function handleRestore(id: string) {
    const result = await restoreTravelLegAction(id);
    if (!result.ok) throw new Error(result.error);
    await loadData();
  }

  return <div className="mx-auto grid max-w-7xl gap-6">
    <header><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Travel overview</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Routes</h1><p className="mt-2 max-w-2xl text-slate-600">Plan active and potential routes, historical seasons, and equipment movement across travel legs.</p></header>
    {loading ? <p className="text-slate-500">Loading routes…</p> : error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : data ? <>
      <TravelLegEditor
        key={data.travelLegs.map((leg: any) => `${leg.id}:${leg.archivedAt ? "a" : ""}`).sort().join(",")}
        legs={data.travelLegs}
        legResources={data.legResources}
        managerAccess={data.managerAccess}
        onSaveLeg={handleSaveLeg}
        onSaveOrder={handleSaveOrder}
        onSetManagerPassword={handleSetManagerPassword}
        onSignOutManagerDevices={handleSignOutManagerDevices}
        onAdd={handleAdd}
        onArchive={handleArchive}
        onRestore={handleRestore}
      />
      <a className="rounded-xl border bg-white p-4 font-semibold" href="/manager-finance">View all leg finances →</a>
      <TripsSection travelLegs={data.travelLegs} />
      <EquipmentHandoffs travelLegs={data.travelLegs} onChange={setHandoffs} />
      <section aria-labelledby="event-map-title" className="grid gap-4"><div><h2 className="text-2xl font-bold" id="event-map-title">Event map</h2><p className="mt-1 text-sm text-slate-600">Bookings with a leg and usable location participate automatically. Suggested and approved equipment meetups are shown separately from events.</p></div><EventMap events={data.events} travelLegs={data.travelLegs} handoffs={handoffs} /></section>
    </> : null}
  </div>;
}
