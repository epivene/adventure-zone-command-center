import { EventMap } from "@/components/routes/event-map";
import { getMapEvents, type MapFilters } from "@/features/routes/map-query";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

const allEvents: MapFilters = {
  statuses: [],
  travelLegIds: [],
  dateFrom: null,
  dateTo: null,
  regions: [],
};

async function loadRouteMap() {
  await requireOwner();
  const { db } = await import("@/db/client");
  const repository = new DrizzleTravelLegRepository(db);
  const [events, travelLegs] = await Promise.all([
    getMapEvents(allEvents, repository),
    repository.listTravelLegs(),
  ]);
  return { events, travelLegs };
}

export default async function RoutesPage() {
  const { events, travelLegs } = await loadRouteMap();

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Travel overview
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Routes</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Filter event locations across four configurable travel legs. Stage 1
          keeps this view descriptive—it does not optimize or recommend travel.
        </p>
      </header>

      <EventMap events={events} travelLegs={travelLegs} />
    </div>
  );
}
