import { EventCalendar } from "@/components/calendar/event-calendar";
import { getMapEvents, type MapFilters } from "@/features/routes/map-query";
import { requireOwner } from "@/lib/auth/require-owner";
import { businessDateKey } from "@/lib/business-date";

export const dynamic = "force-dynamic";

const allEvents: MapFilters = {
  statuses: [],
  travelLegIds: [],
  dateFrom: null,
  dateTo: null,
  regions: [],
};

async function loadEvents() {
  await requireOwner();
  return getMapEvents(allEvents);
}

export default async function CalendarPage() {
  const events = await loadEvents();
  const now = new Date();
  const initialMonth = businessDateKey(now).slice(0, 7);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Schedule
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Calendar</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          See confirmed and tentative event dates, then open a booking for the
          complete record.
        </p>
      </header>

      <EventCalendar events={events} initialMonth={initialMonth} />
    </div>
  );
}
