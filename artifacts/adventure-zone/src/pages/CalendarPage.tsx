import { useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { EventCalendar, type CalendarEvent } from "@/components/calendar/event-calendar";
import { HistorySuggestions } from "@/components/calendar/history-suggestions";
import { businessDateKey } from "@/lib/business-date";

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const now = new Date();
  const initialMonth = businessDateKey(now).slice(0, 7);

  useEffect(() => {
    apiGet<CalendarEvent[]>("/calendar")
      .then((data) => {
        setEvents(
          (data ?? []).map((e) => ({
            ...e,
            startsAt: e.startsAt ? new Date(e.startsAt) : null,
            endsAt: e.endsAt ? new Date(e.endsAt) : null,
          })) as CalendarEvent[],
        );
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
            Schedule
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            See confirmed and tentative event dates, plus imported Act! activities.
          </p>
        </div>
        <button
          onClick={() => setShowSuggestions((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-100 transition-colors"
        >
          <span>✦</span>
          {showSuggestions ? "Hide AI suggestions" : "Suggest bookings from history"}
        </button>
      </header>

      {showSuggestions && (
        <section className="rounded-2xl border border-orange-100 bg-white p-6 shadow-sm">
          <HistorySuggestions />
        </section>
      )}

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
