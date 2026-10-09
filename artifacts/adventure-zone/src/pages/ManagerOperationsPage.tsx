import { LegSeasonEditor } from "@/components/leg-planning/leg-season-editor";
import { ApprovalQueue } from "@/components/leg-planning/approval-review";
import { useEffect, useMemo, useState } from "react";
import { BookingLegOperationsCard } from '@/components/bookings/leg-operations-panel';
import { createOperationsReadClient } from '@/features/bookings/booking-leg-operations-client';
import { ManagerScopedMap } from "@/components/manager/manager-scoped-map";
import { ManagerTravelPlanningPanel } from "@/components/manager/manager-travel-planning-panel";
import { ManagerCrewTravelCard } from "@/components/manager/manager-crew-travel-card";
import { MileageForm } from "@/components/manager/mileage-form";
import { MaintenanceForm } from "@/components/manager/maintenance-form";
import { useManagerScopedMap } from "@/features/manager/use-manager-scoped-map";
import { useManagerAuth } from "@/lib/manager-auth-context";
import type { ManagerDashboardResponse } from "@workspace/api-zod";
import { Link } from "wouter";
import type { YearEndInspectionDto } from "@/lib/year-end-inspections-api";

export default function ManagerOperationsPage() {
  const { managerApi, manager } = useManagerAuth();
  const [planningSeason,setPlanningSeason] = useState(() => Number(new URLSearchParams(window.location.search).get("season")) || new Date().getFullYear());
  const [dashboard, setDashboard] = useState<any>(null);
  const [rollup, setRollup] = useState<any>(null);
  const [yearEndInspection, setYearEndInspection] = useState<YearEndInspectionDto | null>(null);
  const map = useManagerScopedMap();
  const operationsClient = useMemo(() => createOperationsReadClient(managerApi, 'manager'), [managerApi]);
  const [selectedBooking, setSelectedBooking] = useState(() => new URLSearchParams(window.location.search).get('bookingId') ?? '');
  const assignedEvents = map.data?.events ?? [];
  const bookingId = assignedEvents.some(event => event.bookingId === selectedBooking) ? selectedBooking : null;

  useEffect(() => {
    managerApi<ManagerDashboardResponse>("/manager/dashboard").then(async (data) => {
      setDashboard(data);
      const tripId = data.route?.trip?.id ?? data.trips?.[0]?.id;
      if (tripId) setRollup(await managerApi(`/manager/operations/segments?tripId=${tripId}`));
    });
  }, [managerApi]);

  useEffect(() => {
    managerApi<{ inspection: YearEndInspectionDto | null }>(`/manager/year-end-inspections?year=${new Date().getFullYear()}`)
      .then((response) => setYearEndInspection(response.inspection))
      .catch(() => undefined);
  }, [managerApi]);

  const tripId = dashboard?.route?.trip?.id ?? dashboard?.trips?.[0]?.id ?? null;

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">Your leg</p>
        <h1 className="text-2xl font-bold">Trip operations</h1>
        <p className="mt-1 text-sm text-slate-600">Plan, navigate, and log travel for your assigned leg in one view. Official itinerary changes are sent to admin for approval.</p>
      </div>

      <Link href="/manager/year-end-inspection" className="rounded-xl border-2 border-orange-300 bg-orange-50 p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-orange-700">End of season</p>
        <h2 className="mt-1 text-lg font-bold">Year-End Inspection</h2>
        <p className="mt-1 text-sm text-slate-700">{yearEndInspection
          ? `${yearEndInspection.progress.inspected + yearEndInspection.progress.notPresent} of ${yearEndInspection.progress.total} inspected`
          : "Start the piece-by-piece inspection for this leg"}</p>
      </Link>

      <ApprovalQueue role="manager"/>
      {manager ? <details className="rounded-xl border p-3"><summary className="font-semibold">Season staffing &amp; base</summary><label className="grid gap-1 mt-2">Staffing season<input type="number" min="1900" max="9998" value={planningSeason} onChange={e=>setPlanningSeason(Number(e.target.value))}/></label><LegSeasonEditor key={`${manager.legId}:${planningSeason}`} legId={manager.legId} seasonYear={planningSeason} role="manager"/></details> : null}
      {map.error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{map.error}</p> : null}
      {assignedEvents.length > 0 ? <section className="grid gap-3" aria-label="Assigned event operations">
        <label className="text-sm font-semibold">Assigned event
          <select className="mt-1 block w-full rounded border bg-white p-2" value={bookingId ?? ''} onChange={event => setSelectedBooking(event.target.value)}>
            <option value="">Choose an assigned event</option>
            {assignedEvents.map(event => <option key={event.bookingId} value={event.bookingId}>{event.bookingName}</option>)}
          </select>
        </label>
        {bookingId ? <BookingLegOperationsCard bookingId={bookingId} client={operationsClient} role="manager" /> : null}
        {bookingId ? <ManagerCrewTravelCard key={bookingId} bookingId={bookingId} /> : null}
      </section> : null}
      {map.data ? (
        <ManagerScopedMap data={map.data} variant="operations" mode="on-road" />
      ) : map.loading ? <p className="text-sm text-slate-500">Loading map…</p> : null}

      {rollup ? (
        <section className="rounded-xl border bg-white p-4">
          <p>Route miles: {rollup.trip.routeMiles}</p>
          <p>Recorded miles: {rollup.trip.recordedMiles}</p>
          <p>Segment expenses: ${(rollup.trip.expenseTotalCents / 100).toFixed(2)}</p>
        </section>
      ) : null}

      {!tripId ? <p className="rounded-xl border bg-orange-50 p-3 text-sm">No formal trip has been created yet. Booked events assigned to this leg still appear on the map; leg-level travel updates can still be saved.</p> : null}

      {map.data ? <ManagerTravelPlanningPanel managerApi={managerApi} tripId={tripId} mapData={map.data} compact={false} /> : null}

      <section className="grid gap-4" aria-label="Travel logging">
        <MileageForm tripId={tripId} />
        <MaintenanceForm tripId={tripId} />
      </section>
    </div>
  );
}
