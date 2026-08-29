import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPut } from "@/lib/auth-token";
import { EventCalendar, type CalendarEvent } from "@/components/calendar/event-calendar";
import { HistorySuggestions } from "@/components/calendar/history-suggestions";
import { RouteConflictWarning } from "@/components/routes/route-conflict-warning";
import { businessDateKey } from "@/lib/business-date";
import { calendarInitialMonth, normalizeCalendarBookingDates } from "@/features/calendar/calendar-display";
import { dedupeCalendarBookings } from "@/features/calendar/calendar-dedupe";
import {
  DEFAULT_SCHEDULE_DISPLAY_COLORS,
  type ScheduleDisplayColors,
} from "@/features/calendar/calendar-visual-blocks";
import { asScheduleCalendarEvent, isBookedForSchedule } from "@/features/calendar/schedule-booking-state";
import { findSameLegDateConflicts } from "@/features/routes/route-conflicts";

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
  onVisibleMonthChange?: (month: string) => void;
};

function isActActivity(event: CalendarEvent) {
  return event.source === "act_activity";
}

function isGoogleOperationalReview(event: CalendarEvent) {
  return (event as any).source === "google_operational_review";
}

type OperationalCalendarStatus = {
  reviewEvents?: Array<Record<string, unknown>>;
};

type SaveScheduleColorsResponse = {
  ok: true;
  settings: ScheduleDisplayColors;
};

function ScheduleColorSettings({ colors, onSaved }: { colors: ScheduleDisplayColors; onSaved: (colors: ScheduleDisplayColors) => void }) {
  const [draft, setDraft] = useState(colors);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setDraft(colors), [colors]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await apiPut<SaveScheduleColorsResponse>("/settings/schedule-display", draft);
      onSaved(response.settings);
      setDraft(response.settings);
      setMessage("Saved for everyone.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save calendar colors.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">Schedule colors</h3>
          <p className="mt-1 text-sm text-slate-600">Shared for everyone using the Schedule.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input aria-label="Event days color" className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1" onChange={(event) => setDraft((current) => ({ ...current, eventColor: event.target.value }))} type="color" value={draft.eventColor} />
            <span>Event days</span>
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input aria-label="Travel days color" className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1" onChange={(event) => setDraft((current) => ({ ...current, travelColor: event.target.value }))} type="color" value={draft.travelColor} />
            <span>Travel/setup</span>
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="button-primary px-4 py-2" disabled={saving} onClick={save} type="button">{saving ? "Saving…" : "Save colors"}</button>
        {message ? <span className="text-sm font-semibold text-slate-600">{message}</span> : null}
      </div>
    </section>
  );
}

export function CalendarContent({ season, legId, status, embedded = false, onVisibleMonthChange }: ScheduleFilterProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPotential, setShowPotential] = useState(false);
  const [scheduleColors, setScheduleColors] = useState<ScheduleDisplayColors>({ ...DEFAULT_SCHEDULE_DISPLAY_COLORS });

  const todayKey = businessDateKey(new Date());
  const currentYear = todayKey.slice(0, 4);
  const initialMonth = calendarInitialMonth(season, todayKey);
  const [activeMonth, setActiveMonth] = useState(initialMonth);

  useEffect(() => {
    apiGet<ScheduleDisplayColors>("/calendar/display-settings")
      .then((settings) => setScheduleColors(settings))
      .catch(() => setScheduleColors({ ...DEFAULT_SCHEDULE_DISPLAY_COLORS }));
  }, []);

  useEffect(() => {
    if (!season || !/^\d{4}$/.test(season)) return;
    setActiveMonth((current) => {
      if (current.startsWith(`${season}-`)) return current;
      return season === currentYear ? todayKey.slice(0, 7) : `${season}-01`;
    });
  }, [season, currentYear, todayKey]);

  useEffect(() => {
    const { from, to } = buildDateWindow(activeMonth);
    setLoading(true);
    Promise.all([
      apiGet<CalendarEvent[]>(`/calendar?from=${from}&to=${to}`),
      apiGet<OperationalCalendarStatus>("/google-workspace/operational-calendar").catch(() => ({ reviewEvents: [] })),
    ])
      .then(([calendarData, operationalStatus]) => {
        const combined = [...(calendarData ?? []), ...((operationalStatus.reviewEvents ?? []) as unknown as CalendarEvent[])];
        const parsed = combined.map((event) => {
          const raw = event as any;
          const converted = {
            ...event,
            startsAt: event.startsAt ? new Date(event.startsAt) : null,
            endsAt: event.endsAt ? new Date(event.endsAt) : null,
            actualStartsAt: raw.actualStartsAt ? new Date(raw.actualStartsAt) : null,
            actualEndsAt: raw.actualEndsAt ? new Date(raw.actualEndsAt) : null,
          } as CalendarEvent;
          return isActActivity(converted)
            ? converted
            : normalizeCalendarBookingDates(converted as CalendarEvent & { startsAt: Date | null; endsAt: Date | null });
        });
        setEvents(parsed as CalendarEvent[]);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeMonth]);

  const scopedEvents = useMemo(() => (events as any[]).filter((event) => {
    if (legId && event.travelLegId !== legId) return false;
    if (status && status !== "all" && String(event.status ?? "").toLowerCase() !== status.toLowerCase()) return false;
    if (season && event.startsAt && new Date(event.startsAt).getFullYear().toString() !== season) return false;
    return true;
  }) as CalendarEvent[], [events, legId, status, season]);

  const displayEvents = useMemo(() => {
    const activities = scopedEvents.filter((event) => isActActivity(event));
    const reviewEvents = scopedEvents.filter((event) => isGoogleOperationalReview(event));
    const bookings = scopedEvents.filter((event) => !isActActivity(event) && !isGoogleOperationalReview(event));
    return [...dedupeCalendarBookings(bookings as any[]), ...reviewEvents, ...activities] as CalendarEvent[];
  }, [scopedEvents]);

  const routeConflicts = useMemo(() => findSameLegDateConflicts(
    displayEvents.filter((event) => !isActActivity(event)) as any[],
  ), [displayEvents]);
  const hasExplicitStatusFilter = Boolean(status && status !== "all");
  const potentialBookingCount = useMemo(() => displayEvents.filter((event) =>
    !isActActivity(event) &&
    !isGoogleOperationalReview(event) &&
    !isBookedForSchedule(event as any)
  ).length, [displayEvents]);
  const filteredEvents = useMemo(() => {
    const visibleEvents = hasExplicitStatusFilter || showPotential
      ? displayEvents
      : displayEvents.filter((event) =>
          isActActivity(event) ||
          isGoogleOperationalReview(event) ||
          isBookedForSchedule(event as any)
        );

    return visibleEvents.map((event) =>
      isActActivity(event) || isGoogleOperationalReview(event)
        ? event
        : asScheduleCalendarEvent(event as any)
    ) as CalendarEvent[];
  }, [displayEvents, hasExplicitStatusFilter, showPotential]);

  const handleMonthChange = useCallback((month: string) => {
    setActiveMonth(month);
    onVisibleMonthChange?.(month);
  }, [onVisibleMonthChange]);

  const calendarTools = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!hasExplicitStatusFilter && potentialBookingCount > 0 ? (
        <button
          className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${showPotential ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          onClick={() => setShowPotential((value) => !value)}
          type="button"
        >
          {showPotential ? "Hide potential" : `Show potential (${potentialBookingCount})`}
        </button>
      ) : null}
      <button onClick={() => setShowSuggestions((value) => !value)} className={embedded ? "text-sm font-semibold text-slate-500 hover:text-orange-700" : "button-secondary"} type="button">
        {showSuggestions ? (embedded ? "Hide extra tools" : "Hide suggestions") : "More"}
      </button>
    </div>
  );

  return (
    <div className="grid gap-4">
      {!embedded ? (
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Schedule</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Calendar</h1><p className="mt-2 max-w-2xl text-slate-600">Booked events are shown first. Potential bookings stay available when you need planning context.</p></div>
          {calendarTools}
        </header>
      ) : calendarTools}

      <RouteConflictWarning conflicts={routeConflicts} />
      {showSuggestions ? (
        <section className="grid gap-4 rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
          <ScheduleColorSettings colors={scheduleColors} onSaved={setScheduleColors} />
          <HistorySuggestions />
        </section>
      ) : null}
      {loading ? <p className="text-slate-500">Loading calendar…</p> : error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : <EventCalendar colors={scheduleColors} events={filteredEvents} initialMonth={activeMonth} onMonthChange={handleMonthChange} />}
    </div>
  );
}

export default function CalendarPage() {
  return <div className="mx-auto max-w-7xl"><CalendarContent /></div>;
}
