import type { ManagerDashboardResponse, ManagerScheduleEvent } from "@workspace/api-zod";
import { EventScheduleWindow } from "./event-schedule-window";
import { googleDirectionsUrl, managerEventDirectionsDestination } from "@/features/routes/manager-map-navigation";
import { trackEvent } from "@/lib/analytics";

type ManagerRoute = ManagerDashboardResponse["route"];

function formatDriveTime(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function travelEstimate(event: ManagerScheduleEvent, route: ManagerRoute) {
  if (!route) return null;
  const stop = route.stops.find((candidate) => candidate.bookingId === event.bookingId);
  if (!stop) return null;
  const segment = route.segments[stop.sortOrder - 1];
  if (!segment) return null;
  const miles = segment.effectiveMiles;
  const minutes = segment.effectiveMinutes;
  const mpg = route.trip.mpg;
  const price = route.trip.fuelPricePerGallon;
  const fuelGallons = miles != null && mpg != null && mpg > 0 ? miles / mpg : null;
  const gasCost = fuelGallons != null && price != null ? fuelGallons * price : null;
  return { miles, minutes, fuelGallons, gasCost };
}

export function NextEventPlanCard({ event, onSelect, route = null }: {
  event: ManagerScheduleEvent;
  onSelect: () => void;
  route?: ManagerRoute;
}) {
  const location = [event.city, event.region].filter(Boolean).join(", ") || "Location not set";
  const destination = managerEventDirectionsDestination(event);
  const directionsUrl = destination ? googleDirectionsUrl({ destination }) : null;
  const estimate = travelEstimate(event, route);

  return (
    <section className="grid gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm" aria-labelledby="next-event-planning-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-label={`View ${event.bookingName} details`}
          onClick={onSelect}
        >
          <p className="text-xs font-bold uppercase tracking-wide text-orange-800">Next event</p>
          <h2 id="next-event-planning-title" className="mt-1 font-bold">{event.bookingName}</h2>
          <p className="text-sm text-slate-700">{location}</p>
          <EventScheduleWindow startsAt={event.startsAt} endsAt={event.endsAt} operationalStartsAt={event.operationalStartsAt} operationalEndsAt={event.operationalEndsAt} className="mt-1 grid gap-0.5 text-sm text-slate-800" />
        </button>
        {directionsUrl ? <a
          className="button-primary inline-flex w-full shrink-0 items-center justify-center sm:w-auto"
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => trackEvent("next_event_directions_clicked", {
            surface: "manager_schedule",
            destination_type: Array.isArray(destination) ? "coordinates" : "city_region",
          })}
        >
          Get directions
        </a> : <p className="max-w-xs text-sm font-semibold text-slate-600">Add a city or coordinates to plan directions.</p>}
      </div>
      {estimate && (estimate.miles != null || estimate.minutes != null || estimate.fuelGallons != null) ? <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3" aria-label="Travel estimate">
        {estimate.miles != null ? <p className="rounded-lg bg-white px-3 py-2 font-semibold">{Math.round(estimate.miles)} mi</p> : null}
        {estimate.minutes != null ? <p className="rounded-lg bg-white px-3 py-2 font-semibold">{formatDriveTime(estimate.minutes)}</p> : null}
        {estimate.gasCost != null
          ? <p className="rounded-lg bg-white px-3 py-2 font-semibold">${estimate.gasCost.toFixed(2)} estimated gas</p>
          : estimate.fuelGallons != null
            ? <p className="rounded-lg bg-white px-3 py-2 font-semibold">{estimate.fuelGallons.toFixed(1)} gal estimated fuel</p>
            : null}
      </div> : null}
      <p className="text-xs text-orange-900">Select the event to open details and focus its map marker.</p>
    </section>
  );
}