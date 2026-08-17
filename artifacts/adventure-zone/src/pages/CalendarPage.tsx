import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { EventCalendar, type CalendarEvent } from "@/components/calendar/event-calendar";
import { HistorySuggestions } from "@/components/calendar/history-suggestions";
import { businessDateKey } from "@/lib/business-date";

function buildDateWindow(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const fromDate = new Date(Date.UTC((year ?? 0), (month ?? 1) - 1 - 6, 1));
  const toDate = new Date(Date.UTC((year ?? 0), (month ?? 1) - 1 + 7, 0));
  return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) };
}

export type ScheduleFilterProps = {
  season?: string;
  legId?: string;
  status?: string;
  embedded?: boolean;
};

export function CalendarContent({ season, legId, status, embedded = false }: ScheduleFilterProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const now = new Date();
  const currentMonth = businessDateKey(now).slice(0, 7);
  const initialMonth = season && /^\d{4}$/.test(season) ? `${season}-01` : currentMonth;
  const [activeMonth, setActiveMonth] = useState(initialMonth);

  useEffect(() => {
    if (season && /^\d{4}$/.test(season)) setActiveMonth((current) => current.startsWith(`${season}-`) ? current : `${season}-01`);
  }, [season]);

  useEffect(() => {
    const { from, to } = buildDateWindow(activeMonth);
    setLoading(true);
    apiGet<CalendarEvent[]>(`/calendar?from=${from}&to=${to}`)
      .then((data) => {
        setEvents((data ?? []).map((event) => ({ ...event, startsAt: event.startsAt ? new Date(event.startsAt) : null, endsAt: event.endsAt ? new Date(event.endsAt) : null })) as CalendarEvent[]);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeMonth]);

  const filteredEvents = useMemo(() => (events as any[]).filter((event) => {
    if (legId && event.travelLegId !== legId) return false;
    if (status && status !== "all" && String(event.status ?? "").toLowerCase() !== status.toLowerCase()) return false;
    if (season && event.startsAt && new Date(event.startsAt).getFullYear().toString() !== season) return false;
    return true;
  }) as CalendarEvent[], [events, legId, status, season]);

  const handleMonthChange = useCallback((month: string) => setActiveMonth(month), []);

  return (
    <div className="grid gap-4">
      {!embedded ? (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Schedule</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Calendar</h1><p className="mt-2 max-w-2xl text-slate-600">Confirmed, tentative, and imported activity dates.</p></div>
          <button onClick={() => setShowSuggestions((value) => !value)} className="button-secondary">{showSuggestions ? "Hide AI suggestions" : "Suggest bookings from history"}</button>
        </header>
      ) : (
        <div className="flex justify-end"><button onClick={() => setShowSuggestions((value) => !value)} className="text-sm font-semibold text-orange-700">{showSuggestions ? "Hide suggestions" : "History suggestions"}</button></div>
      )}

      {showSuggestions ? <section className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm"><HistorySuggestions /></section> : null}
      {loading ? <p className="text-slate-500">Loading calendar…</p> : error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : <EventCalendar events={filteredEvents} initialMonth={initialMonth} onMonthChange={handleMonthChange} />}
    </div>
  );
}

export default function CalendarPage() {
  return <div className="mx-auto max-w-7xl"><CalendarContent /></div>;
}
