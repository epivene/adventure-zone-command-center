import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/auth-token";
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
import {
  resolveOperationalCalendarReview,
  type OperationalCalendarCandidate,
  type OperationalCalendarReview,
  type OperationalCalendarStatus,
} from "@/features/google-workspace/operational-calendar-client";

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

function dedupeOperationalReviews(events: CalendarEvent[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!isGoogleOperationalReview(event)) return true;
    const key = `google-review:${String((event as any).reviewId ?? event.id)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function reviewDetails(review: OperationalCalendarReview) {
  const proposed = asRecord(review.proposedChanges);
  const parsed = asRecord(proposed.parsed);
  const google = asRecord(proposed.google);
  const candidateBookings = Array.isArray(proposed.candidateBookings)
    ? proposed.candidateBookings.filter((value): value is OperationalCalendarCandidate => {
        const candidate = asRecord(value);
        return typeof candidate.bookingId === "string" && typeof candidate.bookingName === "string";
      })
    : [];
  return { parsed, google, candidateBookings };
}

function formatReviewDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date)
    : null;
}

function formatReviewWindow(startValue: unknown, endExclusiveValue: unknown) {
  const start = formatReviewDate(startValue);
  const endExclusive = typeof endExclusiveValue === "string"
    ? new Date(endExclusiveValue.includes("T") ? endExclusiveValue : `${endExclusiveValue}T00:00:00.000Z`)
    : null;
  const end = endExclusive && Number.isFinite(endExclusive.getTime())
    ? formatReviewDate(new Date(endExclusive.getTime() - 86_400_000).toISOString())
    : null;
  return start ? `${start}${end ? ` – ${end}` : ""}` : null;
}

function OperationalReviewQueue({
  reviews,
  busyReviewId,
  onResolved,
}: {
  reviews: OperationalCalendarReview[];
  busyReviewId: string | null;
  onResolved: (reviewId: string, resolution: "link_existing" | "create_new", bookingId?: string) => Promise<void>;
}) {
  const [selectedBookingByReview, setSelectedBookingByReview] = useState<Record<string, string>>({});
  if (!reviews.length) return null;

  return (
    <section className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-label="Schedule calendar reviews">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Needs resolution</p>
        <h2 className="mt-1 text-xl font-bold text-amber-950">Calendar events waiting for a profile</h2>
        <p className="mt-1 text-sm text-amber-900">Choose the intended existing booking, or create a confirmed profile and booking. Nothing is cleared until the full link is saved.</p>
      </div>
      <div className="grid gap-3">
        {reviews.map((review) => {
          const { parsed, google, candidateBookings } = reviewDetails(review);
          const selectedBookingId = selectedBookingByReview[review.id] ?? "";
          const title = typeof google.summary === "string" && google.summary.trim()
            ? google.summary
            : typeof parsed.eventName === "string" && parsed.eventName.trim()
              ? parsed.eventName
              : "Untitled Google calendar event";
          const calendarWindow = formatReviewWindow(google.startDate, google.endDateExclusive);
          return (
            <article className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm" key={review.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-950">{title}</h3>
                  <p className="mt-1 text-sm text-amber-900">{review.reason}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">Google event {review.googleEventId}</span>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                <div><dt className="inline font-semibold">Calendar: </dt><dd className="inline break-all">{review.calendarId}</dd></div>
                {calendarWindow ? <div><dt className="inline font-semibold">Calendar block: </dt><dd className="inline">{calendarWindow}</dd></div> : null}
                {typeof parsed.city === "string" || typeof parsed.region === "string" ? <div><dt className="inline font-semibold">Location: </dt><dd className="inline">{[parsed.city, parsed.region].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(", ") || "Not provided"}</dd></div> : null}
                {typeof parsed.managerToken === "string" && parsed.managerToken ? <div><dt className="inline font-semibold">Leg/manager: </dt><dd className="inline">{parsed.managerToken}</dd></div> : null}
              </dl>

              {candidateBookings.length ? (
                <fieldset className="mt-4 grid gap-2">
                  <legend className="text-sm font-bold text-slate-900">Competing existing profiles</legend>
                  {candidateBookings.map((candidate) => {
                    const candidateStart = formatReviewDate(candidate.startsAt);
                    const candidateEnd = formatReviewDate(candidate.endsAt);
                    return (
                      <label className={`cursor-pointer rounded-lg border p-3 transition ${selectedBookingId === candidate.bookingId ? "border-orange-400 bg-orange-50" : "border-slate-200 hover:border-orange-300"}`} key={candidate.bookingId}>
                        <span className="flex items-start gap-3">
                          <input
                            aria-label={`Link ${candidate.bookingName}`}
                            checked={selectedBookingId === candidate.bookingId}
                            name={`review-${review.id}`}
                            onChange={() => setSelectedBookingByReview((current) => ({ ...current, [review.id]: candidate.bookingId }))}
                            type="radio"
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-slate-950">{candidate.bookingName}</span>
                            <span className="mt-0.5 block text-xs text-slate-600">
                              {[candidate.profileName, [candidate.city, candidate.region].filter(Boolean).join(", "), candidate.travelLegName, candidateStart && candidateEnd ? `${candidateStart} – ${candidateEnd}` : candidateStart].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">No existing profile was retained as a safe candidate for this event.</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="button-primary" disabled={busyReviewId !== null || !selectedBookingId} onClick={() => void onResolved(review.id, "link_existing", selectedBookingId)} type="button">
                  {busyReviewId === review.id ? "Saving…" : "Link selected booking"}
                </button>
                <button className="button-secondary" disabled={busyReviewId !== null} onClick={() => void onResolved(review.id, "create_new")} type="button">
                  Create new confirmed profile
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

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
  const [reviews, setReviews] = useState<OperationalCalendarReview[]>([]);
  const [busyReviewId, setBusyReviewId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
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
    const { from, to } = season && /^\d{4}$/.test(season)
      ? { from: `${season}-01-01`, to: `${season}-12-31` }
      : buildDateWindow(activeMonth);
    setLoading(true);
    Promise.all([
      apiGet<CalendarEvent[]>(`/calendar?from=${from}&to=${to}`),
      apiGet<OperationalCalendarStatus>("/google-workspace/operational-calendar").catch(() => ({ reviewEvents: [], reviews: [] })),
    ])
      .then(([calendarData, operationalStatus]) => {
        const combined = dedupeOperationalReviews([
          ...(calendarData ?? []),
          ...((operationalStatus.reviewEvents ?? []) as unknown as CalendarEvent[]),
        ]);
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
        setReviews(operationalStatus.reviews ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeMonth, season]);

  async function resolveReview(reviewId: string, resolution: "link_existing" | "create_new", bookingId?: string) {
    setBusyReviewId(reviewId);
    setReviewError(null);
    try {
      await resolveOperationalCalendarReview(reviewId, resolution, bookingId);
      setReviews((current) => current.filter((review) => review.id !== reviewId));
      setEvents((current) => current.filter((event) => (event as any).reviewId !== reviewId));
    } catch (caught) {
      setReviewError(caught instanceof Error ? caught.message : "Could not resolve this calendar review.");
    } finally {
      setBusyReviewId(null);
    }
  }

  const scopedEvents = useMemo(() => (events as any[]).filter((event) => {
    if (legId && event.travelLegId !== legId) return false;
    if (status && status !== "all") {
      const matchesStatus = status.toLowerCase() === "confirmed"
        ? isBookedForSchedule(event)
        : String(event.status ?? "").toLowerCase() === status.toLowerCase();
      if (!matchesStatus) return false;
    }
    if (season && event.startsAt && new Date(event.startsAt).getFullYear().toString() !== season) return false;
    return true;
  }) as CalendarEvent[], [events, legId, status, season]);

  const displayEvents = useMemo(() => {
    const activities = scopedEvents.filter((event) => isActActivity(event));
    const reviewEvents = scopedEvents.filter((event) => isGoogleOperationalReview(event));
    const bookings = scopedEvents.filter((event) => !isActActivity(event) && !isGoogleOperationalReview(event));
    return [...dedupeCalendarBookings(bookings as any[]), ...reviewEvents, ...activities] as CalendarEvent[];
  }, [scopedEvents]);

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
  const routeConflicts = useMemo(() => findSameLegDateConflicts(
    filteredEvents.filter((event) =>
      !isActActivity(event) && !isGoogleOperationalReview(event)
    ) as any[],
  ), [filteredEvents]);

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

      {reviewError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{reviewError}</p> : null}
      <OperationalReviewQueue busyReviewId={busyReviewId} onResolved={resolveReview} reviews={reviews} />
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
