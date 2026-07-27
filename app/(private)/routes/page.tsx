import { EventMap } from "@/components/routes/event-map";
import { TravelLegEditor } from "@/components/routes/travel-leg-editor";
import { updateTravelLegsAction } from "@/app/(private)/routes/actions";
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

      <TravelLegEditor
        legs={travelLegs}
        onSubmit={updateTravelLegsAction}
      />

      <section aria-labelledby="event-map-title" className="grid gap-4">
        <div>
          <h2 className="text-2xl font-bold" id="event-map-title">
            Event map
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Edit a booking to set dates, coordinates, and its travel-leg
            assignment.
          </p>
        </div>
        <EventMap events={events} travelLegs={travelLegs} />
      </section>
    </div>
  );
}
