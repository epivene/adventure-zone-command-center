import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { EventCalendar } from "@/components/calendar/event-calendar";
import { businessDateKey } from "@/lib/business-date";

export default function CalendarPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const initialMonth = businessDateKey(now).slice(0, 7);

  useEffect(() => {
    apiGet<any[]>("/calendar")
      .then((data) => {
        setEvents(
          (data ?? []).map((e) => ({
            ...e,
            startsAt: e.startsAt ? new Date(e.startsAt) : null,
            endsAt: e.endsAt ? new Date(e.endsAt) : null,
          })),
        );
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Schedule
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Calendar</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          See confirmed and tentative event dates.
        </p>
      </header>

      {loading ? (
        <p className="text-slate-500">Loading calendar…</p>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-rose-700">{error}</p>
        </div>
      ) : (
        <EventCalendar events={events} initialMonth={initialMonth} />
      )}
    </div>
  );
}
