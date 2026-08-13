"use client";

import { Link } from "wouter";
import { useMemo, useState } from "react";

import type { MapEvent } from "@/features/routes/map-data";
import {
  BUSINESS_TIME_ZONE,
  businessDateKey,
} from "@/lib/business-date";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActCalendarActivity = {
  source: "act_activity";
  id: string;
  displaySubject: string;
  body: string;
  activityType: "Note" | "History" | "Activity";
  startsAt: Date | null;
  endsAt: Date | null;
  actRecordId: string | null;
  contactId: string | null;
  contactName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  bookingId: string | null;
};

export type BookingEvent = MapEvent & { source?: "booking" | undefined };

export type CalendarEvent = BookingEvent | ActCalendarActivity;

type CalendarView = "month" | "agenda";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(date);
}

function formatStatus(status: string) {
  return status
    .split("_")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function isActActivity(event: CalendarEvent): event is ActCalendarActivity {
  return event.source === "act_activity";
}

function eventStartsAt(event: CalendarEvent): Date | null {
  return event.startsAt;
}

// ─── Booking event card ───────────────────────────────────────────────────────

function BookingEventLink({
  event,
  compact = false,
}: {
  event: BookingEvent;
  compact?: boolean;
}) {
  const confirmed = event.status === "confirmed";
  const color = event.travelLegColor ?? "#64748b";

  return (
    <Link
      className={`block rounded-lg border bg-white px-3 py-2 shadow-sm transition hover:border-orange-300 hover:shadow ${
        confirmed ? "border-slate-200" : "border-dashed border-slate-300"
      }`}
      href={`/bookings/${event.id}`}
      style={{ borderLeftColor: color, borderLeftWidth: "4px" }}
    >
      <span
        className={`block font-bold text-slate-950 ${compact ? "text-xs" : "text-sm"}`}
      >
        {event.name}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
        <span
          className={
            confirmed
              ? "rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800"
              : "rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800"
          }
        >
          {confirmed ? "Confirmed" : "Tentative"}
        </span>
        {!compact ? <span>{formatStatus(event.status)}</span> : null}
      </span>
    </Link>
  );
}

// ─── Act! activity card ───────────────────────────────────────────────────────

const actTypeColors: Record<ActCalendarActivity["activityType"], string> = {
  Note: "bg-sky-100 text-sky-800",
  History: "bg-purple-100 text-purple-800",
  Activity: "bg-teal-100 text-teal-800",
};

function ActActivityCard({
  event,
  compact = false,
  onClick,
}: {
  event: ActCalendarActivity;
  compact?: boolean;
  onClick: (event: ActCalendarActivity) => void;
}) {
  const pillColor = actTypeColors[event.activityType];
  const linkedName = event.organizationName ?? event.contactName;

  return (
    <button
      className={`block w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left transition hover:border-orange-300 hover:bg-white hover:shadow ${
        compact ? "text-xs" : "text-sm"
      }`}
      onClick={() => onClick(event)}
      type="button"
    >
      <span
        className={`block font-medium text-slate-800 ${compact ? "text-xs" : "text-sm"} truncate`}
      >
        {event.displaySubject}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span className={`rounded-full px-2 py-0.5 font-bold ${pillColor}`}>
          Act! {event.activityType}
        </span>
        {linkedName && !compact ? (
          <span className="truncate">{linkedName}</span>
        ) : null}
      </span>
    </button>
  );
}

// ─── Act! activity detail popover ────────────────────────────────────────────

function ActActivityPopover({
  event,
  onClose,
}: {
  event: ActCalendarActivity;
  onClose: () => void;
}) {
  const pillColor = actTypeColors[event.activityType];
  const linkedName = event.organizationName ?? event.contactName;
  const profileHref = event.organizationId
    ? `/profiles/${event.organizationId}`
    : event.contactId
      ? `/contacts/${event.contactId}`
      : null;

  // Show body but truncate if very long; first line is already the subject
  const bodyLines = event.body.split(/\n\n|\n/).filter(Boolean);
  const subjectLine = event.displaySubject;
  const bodyRest = bodyLines
    .filter((line) => line.trim() !== subjectLine.trim())
    .join("\n")
    .trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pillColor}`}>
            Act! {event.activityType}
          </span>
          <button
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <h2 className="text-base font-bold text-slate-900">{subjectLine}</h2>

        {event.startsAt ? (
          <p className="mt-1 text-xs text-slate-500">
            {formatDay(event.startsAt)}
            {event.endsAt && event.endsAt.getTime() !== event.startsAt.getTime()
              ? ` – ${formatDay(event.endsAt)}`
              : ""}
          </p>
        ) : null}

        {linkedName ? (
          <p className="mt-2 text-sm text-slate-700">
            {profileHref ? (
              <Link
                className="font-medium text-orange-700 underline hover:text-orange-900"
                href={profileHref}
                onClick={onClose}
              >
                {linkedName}
              </Link>
            ) : (
              <span className="font-medium">{linkedName}</span>
            )}
          </p>
        ) : null}

        {bodyRest ? (
          <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">
            {bodyRest.length > 600 ? bodyRest.slice(0, 600) + "…" : bodyRest}
          </p>
        ) : null}

        {event.bookingId ? (
          <div className="mt-4">
            <Link
              className="text-sm font-medium text-orange-700 underline hover:text-orange-900"
              href={`/bookings/${event.bookingId}`}
              onClick={onClose}
            >
              View linked booking →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main calendar component ──────────────────────────────────────────────────

export function EventCalendar({
  events,
  initialMonth = businessDateKey(new Date()).slice(0, 7),
}: {
  events: CalendarEvent[];
  initialMonth?: string;
}) {
  const [view, setView] = useState<CalendarView>("month");
  const [activeMonth, setActiveMonth] = useState(() => parseMonth(initialMonth));
  const [showActActivities, setShowActActivities] = useState(true);
  const [selectedActivity, setSelectedActivity] =
    useState<ActCalendarActivity | null>(null);

  // Split into two typed lists
  const { bookingEvents, actEvents } = useMemo(() => {
    const bookingEvents: BookingEvent[] = [];
    const actEvents: ActCalendarActivity[] = [];
    for (const e of events) {
      if (isActActivity(e)) actEvents.push(e);
      else bookingEvents.push(e as BookingEvent);
    }
    return { bookingEvents, actEvents };
  }, [events]);

  const datedBookings = useMemo(
    () =>
      bookingEvents
        .filter((e): e is BookingEvent & { startsAt: Date } => e.startsAt !== null)
        .sort(
          (l, r) => l.startsAt.getTime() - r.startsAt.getTime() || l.id.localeCompare(r.id),
        ),
    [bookingEvents],
  );

  const datedActEvents = useMemo(
    () =>
      actEvents
        .filter((e): e is ActCalendarActivity & { startsAt: Date } => e.startsAt !== null)
        .sort(
          (l, r) => l.startsAt.getTime() - r.startsAt.getTime() || l.id.localeCompare(r.id),
        ),
    [actEvents],
  );

  const allDatedEvents = useMemo(() => {
    const base = [...datedBookings];
    if (showActActivities) {
      const combined = [...base, ...datedActEvents];
      combined.sort((l, r) => {
        const la = eventStartsAt(l);
        const ra = eventStartsAt(r);
        if (!la || !ra) return 0;
        return la.getTime() - ra.getTime() || l.id.localeCompare(r.id);
      });
      return combined as Array<(BookingEvent & { startsAt: Date }) | (ActCalendarActivity & { startsAt: Date })>;
    }
    return base as Array<(BookingEvent & { startsAt: Date }) | (ActCalendarActivity & { startsAt: Date })>;
  }, [datedBookings, datedActEvents, showActActivities]);

  const monthDays = useMemo(() => {
    const gridStart = new Date(activeMonth);
    gridStart.setUTCDate(1 - activeMonth.getUTCDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setUTCDate(gridStart.getUTCDate() + index);
      return date;
    });
  }, [activeMonth]);

  const agendaGroups = useMemo(() => {
    const groups = new Map<string, typeof allDatedEvents>();
    for (const event of allDatedEvents) {
      const key = businessDateKey(event.startsAt).slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.entries()];
  }, [allDatedEvents]);

  function moveMonth(change: number) {
    setActiveMonth(
      (current) =>
        new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + change, 1)),
    );
  }

  return (
    <section className="grid gap-4" aria-label="Event calendar">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1">
            <button
              aria-pressed={view === "month"}
              className={`min-h-10 rounded-md px-4 text-sm font-bold ${
                view === "month" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"
              }`}
              onClick={() => setView("month")}
              type="button"
            >
              Month view
            </button>
            <button
              aria-pressed={view === "agenda"}
              className={`min-h-10 rounded-md px-4 text-sm font-bold ${
                view === "agenda" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"
              }`}
              onClick={() => setView("agenda")}
              type="button"
            >
              Agenda view
            </button>
          </div>

          {/* Act! activity toggle */}
          {actEvents.length > 0 ? (
            <button
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                showActActivities
                  ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
                  : "border-slate-300 bg-slate-50 text-slate-500 hover:bg-slate-100"
              }`}
              onClick={() => setShowActActivities((v) => !v)}
              type="button"
              title={showActActivities ? "Hide Act! activities" : "Show Act! activities"}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${showActActivities ? "bg-teal-500" : "bg-slate-400"}`}
              />
              Act! Activities ({actEvents.length})
            </button>
          ) : null}
        </div>

        {view === "month" ? (
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <button
              aria-label="Previous month"
              className="button-secondary min-w-11 px-3"
              onClick={() => moveMonth(-1)}
              type="button"
            >
              ←
            </button>
            <h2 className="min-w-36 text-center text-lg font-bold">
              {formatMonth(activeMonth)}
            </h2>
            <button
              aria-label="Next month"
              className="button-secondary min-w-11 px-3"
              onClick={() => moveMonth(1)}
              type="button"
            >
              →
            </button>
          </div>
        ) : null}
      </div>

      {/* Calendar grid or agenda */}
      {view === "month" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="hidden grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-bold uppercase tracking-wide text-slate-500 sm:grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div className="p-2" key={day}>
                {day}
              </div>
            ))}
          </div>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-7">
            {monthDays.map((date) => {
              const dateKey = date.toISOString().slice(0, 10);
              const dayEvents = allDatedEvents.filter(
                (event) => businessDateKey(event.startsAt) === dateKey,
              );
              const inMonth = date.getUTCMonth() === activeMonth.getUTCMonth();

              return (
                <div
                  className={`min-h-24 bg-white p-2 sm:min-h-32 ${
                    inMonth ? "" : "text-slate-400"
                  }`}
                  key={date.toISOString()}
                >
                  <div className="mb-2 flex items-center justify-between text-xs font-bold">
                    <span className="sm:hidden">
                      {new Intl.DateTimeFormat("en-US", {
                        weekday: "short",
                        timeZone: "UTC",
                      }).format(date)}
                    </span>
                    <time dateTime={date.toISOString().slice(0, 10)}>
                      {date.getUTCDate()}
                    </time>
                  </div>
                  <div className="grid gap-1.5">
                    {dayEvents.map((event) =>
                      isActActivity(event) ? (
                        <ActActivityCard
                          compact
                          event={event}
                          key={event.id}
                          onClick={setSelectedActivity}
                        />
                      ) : (
                        <BookingEventLink compact event={event} key={event.id} />
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : allDatedEvents.length ? (
        <div className="grid gap-5">
          {agendaGroups.map(([key, groupEvents]) => (
            <section
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              key={key}
            >
              <h2 className="text-xl font-bold">{formatMonth(parseMonth(key))}</h2>
              <ol className="mt-4 grid gap-3">
                {groupEvents.map((event) => (
                  <li
                    className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start"
                    key={event.id}
                  >
                    <time className="pt-2 text-sm font-bold text-slate-600">
                      {formatDay(event.startsAt)}
                    </time>
                    {isActActivity(event) ? (
                      <ActActivityCard
                        event={event}
                        onClick={setSelectedActivity}
                      />
                    ) : (
                      <BookingEventLink event={event} />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold">No dated events yet.</p>
          <p className="mt-1 text-sm text-slate-600">
            Add dates to a booking to place it on the calendar.
          </p>
        </div>
      )}

      {/* Activity detail popover */}
      {selectedActivity ? (
        <ActActivityPopover
          event={selectedActivity}
          onClose={() => setSelectedActivity(null)}
        />
      ) : null}
    </section>
  );
}
