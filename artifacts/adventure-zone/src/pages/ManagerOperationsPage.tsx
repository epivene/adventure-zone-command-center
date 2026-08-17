import { useEffect, useState } from "react";
import { ManagerScopedMap } from "@/components/manager/manager-scoped-map";
import { ManagerTravelPlanningPanel } from "@/components/manager/manager-travel-planning-panel";
import { MileageForm } from "@/components/manager/mileage-form";
import { MaintenanceForm } from "@/components/manager/maintenance-form";
import { useManagerScopedMap } from "@/features/manager/use-manager-scoped-map";
import { readManagerMapMode, writeManagerMapMode, type ManagerMapMode } from "@/features/routes/manager-map-navigation";
import { useManagerAuth } from "@/lib/manager-auth-context";

function initialTravelMode(): ManagerMapMode {
  if (typeof window === "undefined") return "planning";
  return readManagerMapMode(window.localStorage);
}

export default function ManagerOperationsPage() {
  const { managerApi } = useManagerAuth();
  const [dashboard, setDashboard] = useState<any>(null);
  const [rollup, setRollup] = useState<any>(null);
  const [mode, setMode] = useState<ManagerMapMode>(initialTravelMode);
  const map = useManagerScopedMap();

  useEffect(() => {
    managerApi<any>("/manager/dashboard").then(async (data) => {
      setDashboard(data);
      const tripId = data.route?.trip?.id ?? data.trips?.[0]?.id;
      if (tripId) setRollup(await managerApi(`/manager/operations/segments?tripId=${tripId}`));
    });
  }, [managerApi]);

  const tripId = dashboard?.route?.trip?.id ?? dashboard?.trips?.[0]?.id ?? null;

  function changeMode(next: ManagerMapMode) {
    setMode(next);
    if (typeof window !== "undefined") writeManagerMapMode(window.localStorage, next);
  }

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">Your leg</p>
        <h1 className="text-2xl font-bold">Trip operations</h1>
        <p className="mt-1 text-sm text-slate-600">Plan and log travel for your assigned leg. Official itinerary changes are sent to admin for approval.</p>
      </div>

      {map.error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{map.error}</p> : null}
      {map.data ? (
        <ManagerScopedMap data={map.data} variant="operations" mode={mode} onModeChange={changeMode} />
      ) : map.loading ? <p className="text-sm text-slate-500">Loading map…</p> : null}

      {rollup ? (
        <section className="rounded-xl border bg-white p-4">
          <p>Route miles: {rollup.trip.routeMiles}</p>
          <p>Recorded miles: {rollup.trip.recordedMiles}</p>
          <p>Segment expenses: ${(rollup.trip.expenseTotalCents / 100).toFixed(2)}</p>
        </section>
      ) : null}

      {!tripId ? <p className="rounded-xl border bg-orange-50 p-3 text-sm">No formal trip has been created yet. Booked events assigned to this leg still appear on the map; leg-level travel updates can still be saved.</p> : null}

      {map.data ? <ManagerTravelPlanningPanel managerApi={managerApi} tripId={tripId} mapData={map.data} compact={mode === "on-road"} /> : null}

      <section className="grid gap-4" aria-label={mode === "on-road" ? "On the road logging" : "Travel logging"}>
        <MileageForm tripId={tripId} />
        <MaintenanceForm tripId={tripId} />
      </section>
    </div>
  );
}
