import type { ManagerScheduleEvent } from "@workspace/api-zod";
import { googleDirectionsUrl, managerEventDirectionsDestination } from "@/features/routes/manager-map-navigation";

function formatEventDate(value?: string | Date | null) {
  if (!value) return "Date not set";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatEventRange(startsAt?: string | Date | null, endsAt?: string | Date | null) {
  if (!startsAt) return "Date not set";
  if (!endsAt || endsAt === startsAt) return formatEventDate(startsAt);
  return `${formatEventDate(startsAt)} → ${formatEventDate(endsAt)}`;
}

export function NextEventPlanCard({ event, onSelect }: {
  event: ManagerScheduleEvent;
  onSelect: () => void;
}) {
  const location = [event.city, event.region].filter(Boolean).join(", ") || "Location not set";
  const destination = managerEventDirectionsDestination(event);
  const directionsUrl = destination ? googleDirectionsUrl({ destination }) : null;

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
          <p className="mt-1 text-sm font-semibold text-slate-800">{formatEventRange(event.startsAt, event.endsAt)}</p>
        </button>
        {directionsUrl ? <a className="button-primary inline-flex w-full shrink-0 items-center justify-center sm:w-auto" href={directionsUrl} target="_blank" rel="noreferrer">
          Get directions
        </a> : <p className="max-w-xs text-sm font-semibold text-slate-600">Add a city or coordinates to plan directions.</p>}
      </div>
      <p className="text-xs text-orange-900">Select the event to open details and focus its map marker.</p>
    </section>
  );
}