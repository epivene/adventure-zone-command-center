"use client";

import { Link } from "wouter";
import { useEffect, useMemo, useState } from "react";

import type { MapEvent } from "@/features/routes/map-data";
import { buildMonthSpanSegments, type MonthSpanSegment } from "@/features/calendar/month-spans";
import {
  bookingVisualKindOnDate,
  calendarBookingLabel,
  colorForBookingDay,
  DEFAULT_SCHEDULE_DISPLAY_COLORS,
  type ScheduleDisplayColors,
} from "@/features/calendar/calendar-visual-blocks";
import { calendarEventPublicStart, futureCalendarEvents } from "@/features/calendar/upcoming-events";
import { BUSINESS_TIME_ZONE, businessDateKey } from "@/lib/business-date";

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

export type BookingEvent = MapEvent & {
  source?: "booking" | "google_operational_review" | undefined;
  actualStartsAt?: Date | null;
  actualEndsAt?: Date | null;
  operationalWindowSource?: string | null;
};
export type CalendarEvent = BookingEvent | ActCalendarActivity;
type CalendarView = "month" | "agenda";
type PositionedSegment = MonthSpanSegment & { lane: number };

function parseMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function initialSelectedDay(month: string) {
  const today = businessDateKey(new Date());
  return today.startsWith(`${month}-`) ? today : `${month}-01`;
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(date);
}

function formatSelectedDay(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatStatus(status: string) {
  return status.split("_").map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isActActivity(event: CalendarEvent): event is ActCalendarActivity {
  return event.source === "act_activity";
}

function eventStartsAt(event: CalendarEvent): Date | null {
  return event.startsAt;
}

function bookingOccursOn(event: BookingEvent, dateKey: string) {
  if (!event.startsAt) return false;
  const start = utcDateKey(event.startsAt);
  const candidateEnd = utcDateKey(event.endsAt ?? event.startsAt);
  const end = candidateEnd < start ? start : candidateEnd;
  return start <= dateKey && dateKey <= end;
}

function positionWeekSegments(segments: MonthSpanSegment[]): PositionedSegment[] {
  const positioned: PositionedSegment[] = [];
  const occupiedByLane: Array<Array<[number, number]>> = [];
  for (const segment of [...segments].sort((a, b) => {
    const widthA = a.endColumn - a.startColumn;
    const widthB = b.endColumn - b.startColumn;
    return a.startColumn - b.startColumn || widthB - widthA || a.eventId.localeCompare(b.eventId);
  })) {
    let lane = 0;
    while (true) {
      const occupied = occupiedByLane[lane] ?? [];
      const conflicts = occupied.some(([start, end]) => !(segment.endColumn < start || segment.startColumn > end));
      if (!conflicts) {
        occupied.push([segment.startColumn, segment.endColumn]);
        occupiedByLane[lane] = occupied;
        positioned.push({ ...segment, lane });
        break;
      }
      lane += 1;
    }
  }
  return positioned;
}

function bookingHref(event: BookingEvent) {
  return `/bookings/${event.id}`;
}

function BookingEventLink({ event, compact = false }: { event: BookingEvent; compact?: boolean }) {
  const confirmed = event.status === "confirmed";
  const color = event.travelLegColor ?? "#64748b";
  return (
    <Link className={`block rounded-lg border bg-white px-3 py-2 shadow-sm transition hover:border-orange-300 hover:shadow ${confirmed ? "border-slate-200" : "border-dashed border-slate-300"}`} href={bookingHref(event)} style={{ borderLeftColor: color, borderLeftWidth: "4px" }}>
      <span className={`block font-bold text-slate-950 ${compact ? "text-xs" : "text-sm"}`}>{calendarBookingLabel(event)}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
        <span className={confirmed ? "rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800" : "rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800"}>{confirmed ? "Confirmed" : "Tentative"}</span>
        {!compact ? <span>{formatStatus(event.status)}</span> : null}
      </span>
    </Link>
  );
}

const actTypeColors: Record<ActCalendarActivity["activityType"], string> = {
  Note: "bg-sky-100 text-sky-800",
  History: "bg-purple-100 text-purple-800",
  Activity: "bg-teal-100 text-teal-800",
};

function ActActivityCard({ event, compact = false, onClick }: { event: ActCalendarActivity; compact?: boolean; onClick: (event: ActCalendarActivity) => void }) {
  const pillColor = actTypeColors[event.activityType];
  const linkedName = event.organizationName ?? event.contactName;
  return (
    <button className={`block w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left transition hover:border-orange-300 hover:bg-white hover:shadow ${compact ? "text-xs" : "text-sm"}`} onClick={() => onClick(event)} type="button">
      <span className={`block truncate font-medium text-slate-800 ${compact ? "text-xs" : "text-sm"}`}>{event.displaySubject}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span className={`rounded-full px-2 py-0.5 font-bold ${pillColor}`}>ACT {event.activityType}</span>{linkedName && !compact ? <span className="truncate">{linkedName}</span> : null}</span>
    </button>
  );
}

function ActActivityPopover({ event, onClose }: { event: ActCalendarActivity; onClose: () => void }) {
  const pillColor = actTypeColors[event.activityType];
  const linkedName = event.organizationName ?? event.contactName;
  const profileHref = event.organizationId ? `/profiles/${event.organizationId}` : event.contactId ? `/contacts/${event.contactId}` : null;
  const bodyLines = event.body.split(/\n\n|\n/).filter(Boolean);
  const bodyRest = bodyLines.filter((line) => line.trim() !== event.displaySubject.trim()).join("\n").trim();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3"><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pillColor}`}>Imported {event.activityType}</span><button aria-label="Close" className="text-slate-400 hover:text-slate-700" onClick={onClose} type="button">×</button></div>
        <h2 className="text-base font-bold text-slate-900">{event.displaySubject}</h2>
        {event.startsAt ? <p className="mt-1 text-xs text-slate-500">{formatDay(event.startsAt)}{event.endsAt && event.endsAt.getTime() !== event.startsAt.getTime() ? ` – ${formatDay(event.endsAt)}` : ""}</p> : null}
        {linkedName ? <p className="mt-2 text-sm text-slate-700">{profileHref ? <Link className="font-medium text-orange-700 underline hover:text-orange-900" href={profileHref} onClick={onClose}>{linkedName}</Link> : <span className="font-medium">{linkedName}</span>}</p> : null}
        {bodyRest ? <p className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">{bodyRest.length > 600 ? `${bodyRest.slice(0, 600)}…` : bodyRest}</p> : null}
        {event.bookingId ? <div className="mt-4"><Link className="text-sm font-medium text-orange-700 underline hover:text-orange-900" href={`/bookings/${event.bookingId}`} onClick={onClose}>View linked booking →</Link></div> : null}
      </div>
    </div>
  );
}

function gradientForSegment(event: BookingEvent, segment: MonthSpanSegment, days: Date[], colors: ScheduleDisplayColors) {
  const segmentDays = days.slice(segment.startColumn, segment.endColumn + 1);
  if (!segmentDays.length) return colors.eventColor;
  const stops: string[] = [];
  segmentDays.forEach((date, index) => {
    const color = colorForBookingDay(event, utcDateKey(date), colors) ?? colors.eventColor;
    const start = (index / segmentDays.length) * 100;
    const end = ((index + 1) / segmentDays.length) * 100;
    stops.push(`${color} ${start}%`, `${color} ${end}%`);
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function DesktopMonthWeek({ weekIndex, days, bookingEvents, actEvents, segments, activeMonth, onSelectActivity, colors }: { weekIndex: number; days: Date[]; bookingEvents: BookingEvent[]; actEvents: ActCalendarActivity[]; segments: MonthSpanSegment[]; activeMonth: Date; onSelectActivity: (event: ActCalendarActivity) => void; colors: ScheduleDisplayColors }) {
  const positioned = useMemo(() => positionWeekSegments(segments), [segments]);
  const laneCount = positioned.length ? Math.max(...positioned.map((segment) => segment.lane)) + 1 : 0;
  const eventById = useMemo(() => new Map(bookingEvents.map((event) => [event.id, event])), [bookingEvents]);
  const bookingAreaHeight = laneCount * 30;
  return (
    <div className="relative hidden border-b border-slate-200 last:border-b-0 sm:block">
      <div className="grid grid-cols-7 gap-px bg-slate-200">
        {days.map((date) => {
          const key = utcDateKey(date);
          const inMonth = date.getUTCMonth() === activeMonth.getUTCMonth();
          const activities = actEvents.filter((event) => event.startsAt && utcDateKey(event.startsAt) === key);
          return <div className={`min-h-32 bg-white p-2 ${inMonth ? "" : "text-slate-400"}`} key={key} style={{ paddingTop: `${42 + bookingAreaHeight}px` }}><time className="absolute mt-[-34px] text-xs font-bold" dateTime={key}>{date.getUTCDate()}</time><div className="grid gap-1.5">{activities.map((event) => <ActActivityCard compact event={event} key={event.id} onClick={onSelectActivity} />)}</div></div>;
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-9 z-10 grid grid-cols-7 gap-x-px px-px" style={{ gridAutoRows: "28px" }}>
        {positioned.map((segment) => {
          const event = eventById.get(segment.eventId);
          if (!event) return null;
          const confirmed = event.status === "confirmed";
          return <Link className={`pointer-events-auto mx-1 min-w-0 truncate rounded-md border border-white/50 px-2 py-1 text-xs font-bold text-white shadow-sm transition hover:ring-2 hover:ring-orange-300 ${confirmed ? "" : "border-dashed"} ${segment.startsHere ? "" : "rounded-l-none"} ${segment.endsHere ? "" : "rounded-r-none"}`} data-end-column={segment.endColumn} data-start-column={segment.startColumn} data-testid={`booking-span-${event.id}-${weekIndex}`} href={bookingHref(event)} key={`${event.id}-${weekIndex}`} style={{ background: gradientForSegment(event, segment, days, colors), gridColumnStart: segment.startColumn + 1, gridColumnEnd: segment.endColumn + 2, gridRowStart: segment.lane + 1, textShadow: "0 1px 2px rgba(15, 23, 42, 0.8)" }} title={`${calendarBookingLabel(event)}: ${formatDay(event.startsAt!)} – ${formatDay(event.endsAt ?? event.startsAt!)}`}>{segment.startsHere ? calendarBookingLabel(event) : `↳ ${calendarBookingLabel(event)}`}</Link>;
        })}
      </div>
    </div>
  );
}

function MobileBookingStrip({ event, dateKey, colors }: { event: BookingEvent; dateKey: string; colors: ScheduleDisplayColors }) {
  if (!event.startsAt) return null;
  const kind = bookingVisualKindOnDate(event, dateKey);
  if (!kind) return null;
  const startsOn = utcDateKey(event.startsAt);
  const endsOn = utcDateKey(event.endsAt ?? event.startsAt);
  const startsHere = dateKey === startsOn;
  const endsHere = dateKey === endsOn;
  const color = colorForBookingDay(event, dateKey, colors) ?? colors.eventColor;
  const label = calendarBookingLabel(event);
  return (
    <Link
      aria-label={`${label}, ${kind === "event" ? "event" : "travel/setup"}`}
      className={`block h-4 min-w-0 overflow-hidden px-1 text-[9px] font-bold leading-4 shadow-sm ${kind === "event" ? "text-white" : "text-slate-800"} ${startsHere ? "rounded-l-full" : "rounded-l-none"} ${endsHere ? "rounded-r-full" : "rounded-r-none"}`}
      href={bookingHref(event)}
      style={{ backgroundColor: color }}
      title={`${label} · ${kind === "event" ? "Event" : "Travel/setup/teardown"}`}
    >
      {startsHere ? <span className="block truncate">{label}</span> : <span aria-hidden="true">&nbsp;</span>}
    </Link>
  );
}

export function EventCalendar({ events, initialMonth = businessDateKey(new Date()).slice(0, 7), onMonthChange, colors = DEFAULT_SCHEDULE_DISPLAY_COLORS }: { events: CalendarEvent[]; initialMonth?: string; onMonthChange?: (month: string) => void; colors?: ScheduleDisplayColors }) {
  const [view, setView] = useState<CalendarView>("month");
  const activeMonth = useMemo(() => parseMonth(initialMonth), [initialMonth]);
  const [showActActivities, setShowActActivities] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActCalendarActivity | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState(() => initialSelectedDay(initialMonth));
  const [agendaLimit, setAgendaLimit] = useState(12);

  useEffect(() => {
    setSelectedDayKey((current) => current.startsWith(`${initialMonth}-`) ? current : initialSelectedDay(initialMonth));
  }, [initialMonth]);

  const { bookingEvents, actEvents } = useMemo(() => {
    const bookings: BookingEvent[] = [];
    const activities: ActCalendarActivity[] = [];
    for (const event of events) {
      if (isActActivity(event)) activities.push(event);
      else bookings.push(event as BookingEvent);
    }
    return { bookingEvents: bookings, actEvents: activities };
  }, [events]);

  const datedBookings = useMemo(() => bookingEvents.filter((event): event is BookingEvent & { startsAt: Date } => event.startsAt !== null).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id)), [bookingEvents]);
  const datedActEvents = useMemo(() => actEvents.filter((event): event is ActCalendarActivity & { startsAt: Date } => event.startsAt !== null).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id)), [actEvents]);
  const allDatedEvents = useMemo(() => {
    const combined: CalendarEvent[] = [...datedBookings];
    if (showActActivities) combined.push(...datedActEvents);
    return combined.filter((event): event is CalendarEvent & { startsAt: Date } => eventStartsAt(event) !== null).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
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

  const bookingSpanSegments = useMemo(() => buildMonthSpanSegments(datedBookings, monthDays), [datedBookings, monthDays]);
  const selectedDay = monthDays.find((date) => utcDateKey(date) === selectedDayKey) ?? new Date(`${selectedDayKey}T00:00:00Z`);
  const selectedBookings = datedBookings.filter((event) => bookingOccursOn(event, selectedDayKey));
  const selectedActivities = showActActivities ? datedActEvents.filter((event) => utcDateKey(event.startsAt) === selectedDayKey) : [];
  const todayKey = utcDateKey(new Date());
  const futureEvents = useMemo(() => futureCalendarEvents(allDatedEvents), [allDatedEvents]);
  const upcomingEvents = futureEvents.slice(0, agendaLimit);
  const upcomingGroups = useMemo(() => {
    const groups = new Map<string, typeof upcomingEvents>();
    for (const event of upcomingEvents) {
      const key = businessDateKey(calendarEventPublicStart(event));
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.entries()];
  }, [upcomingEvents]);

  function selectMonth(next: Date) {
    const key = monthKey(next);
    setSelectedDayKey(initialSelectedDay(key));
    onMonthChange?.(key);
  }

  function moveMonth(change: number) {
    selectMonth(new Date(Date.UTC(activeMonth.getUTCFullYear(), activeMonth.getUTCMonth() + change, 1)));
  }

  function goToday() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    setSelectedDayKey(businessDateKey(now));
    onMonthChange?.(monthKey(next));
  }

  function chooseMobileDay(date: Date) {
    const key = utcDateKey(date);
    setSelectedDayKey(key);
    if (date.getUTCMonth() !== activeMonth.getUTCMonth() || date.getUTCFullYear() !== activeMonth.getUTCFullYear()) {
      const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
      onMonthChange?.(monthKey(next));
    }
  }

  return (
    <section className="grid gap-3" aria-label="Event calendar">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button aria-pressed={view === "month"} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "month" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`} onClick={() => setView("month")} type="button">Month</button>
            <button aria-pressed={view === "agenda"} className={`rounded-md px-3 py-2 text-sm font-bold ${view === "agenda" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`} onClick={() => { setView("agenda"); setAgendaLimit(12); }} type="button">Upcoming</button>
          </div>
          {actEvents.length > 0 ? (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">More ▾</summary>
              <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input checked={showActActivities} className="mt-0.5" onChange={(event) => setShowActActivities(event.target.checked)} type="checkbox" />
                  <span><strong className="block font-semibold">Show imported ACT activity</strong><span className="mt-0.5 block text-xs text-slate-500">Normally hidden to keep the calendar simple.</span></span>
                </label>
              </div>
            </details>
          ) : null}
        </div>

        {view === "month" ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <button aria-label="Previous month" className="button-secondary min-w-10 px-2.5" onClick={() => moveMonth(-1)} type="button">←</button>
            <button className="min-w-0 flex-1 rounded-lg px-2 py-1 text-center hover:bg-slate-50" onClick={goToday} type="button"><span className="block text-base font-bold">{formatMonth(activeMonth)}</span><span className="text-[11px] font-semibold text-slate-500">Jump to today</span></button>
            <button aria-label="Next month" className="button-secondary min-w-10 px-2.5" onClick={() => moveMonth(1)} type="button">→</button>
          </div>
        ) : null}
      </div>

      {view === "month" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <div className="p-2 sm:hidden" key={`${day}-${index}`}>{day}</div>)}
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div className="hidden p-2 sm:block" key={day}>{day}</div>)}
          </div>

          <div className="sm:hidden">
            <div className="grid grid-cols-7 gap-px bg-slate-200">
              {monthDays.map((date) => {
                const key = utcDateKey(date);
                const inMonth = date.getUTCMonth() === activeMonth.getUTCMonth();
                const bookingsOnDay = datedBookings.filter((event) => bookingOccursOn(event, key));
                const actCount = showActActivities ? datedActEvents.filter((event) => utcDateKey(event.startsAt) === key).length : 0;
                const selected = key === selectedDayKey;
                const today = key === todayKey;
                return (
                  <div className={`relative min-h-20 bg-white pb-1 text-center ${inMonth ? "text-slate-800" : "text-slate-400"} ${selected ? "ring-2 ring-inset ring-orange-400" : ""}`} key={key}>
                    <button aria-label={`${formatSelectedDay(date)}${bookingsOnDay.length + actCount ? `, ${bookingsOnDay.length + actCount} item${bookingsOnDay.length + actCount === 1 ? "" : "s"}` : ""}`} className="block w-full p-1.5 pb-0" onClick={() => chooseMobileDay(date)} type="button">
                      <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${today ? "bg-orange-600 text-white" : ""}`}>{date.getUTCDate()}</span>
                    </button>
                    <div className="mt-1 grid gap-0.5 overflow-hidden">
                      {bookingsOnDay.map((event) => <MobileBookingStrip colors={colors} dateKey={key} event={event} key={event.id} />)}
                      {actCount ? <button className="mx-1 rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-800" onClick={() => chooseMobileDay(date)} type="button">{actCount} ACT</button> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <section className="border-t border-slate-200 p-3">
              <h3 className="font-bold">{formatSelectedDay(selectedDay)}</h3>
              <div className="mt-2 grid gap-2">
                {selectedBookings.map((event) => <BookingEventLink event={event} key={event.id} />)}
                {selectedActivities.map((event) => <ActActivityCard event={event} key={event.id} onClick={setSelectedActivity} />)}
                {!selectedBookings.length && !selectedActivities.length ? <p className="text-sm text-slate-500">Nothing scheduled for this day.</p> : null}
              </div>
            </section>
          </div>

          <div className="hidden sm:block">
            {Array.from({ length: 6 }, (_, weekIndex) => {
              const days = monthDays.slice(weekIndex * 7, weekIndex * 7 + 7);
              return <DesktopMonthWeek activeMonth={activeMonth} actEvents={showActActivities ? datedActEvents : []} bookingEvents={datedBookings} colors={colors} days={days} key={weekIndex} onSelectActivity={setSelectedActivity} segments={bookingSpanSegments.filter((segment) => segment.weekIndex === weekIndex)} weekIndex={weekIndex} />;
            })}
          </div>
        </div>
      ) : upcomingEvents.length ? (
        <div className="grid gap-3">
          {upcomingGroups.map(([key, groupEvents]) => (
            <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" key={key}>
              <h2 className="text-sm font-bold text-slate-700">{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(new Date(`${key}T12:00:00`))}</h2>
              <ol className="mt-2 grid gap-2">{groupEvents.map((event) => <li key={event.id}>{isActActivity(event) ? <ActActivityCard event={event} onClick={setSelectedActivity} /> : <BookingEventLink event={event} />}</li>)}</ol>
            </section>
          ))}
          {futureEvents.length > agendaLimit ? <button className="button-secondary justify-self-center" onClick={() => setAgendaLimit((value) => value + 12)} type="button">Show more</button> : null}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold">No upcoming events.</p><p className="mt-1 text-sm text-slate-600">Past events stay available in Month view.</p></div>
      )}

      {selectedActivity ? <ActActivityPopover event={selectedActivity} onClose={() => setSelectedActivity(null)} /> : null}
    </section>
  );
}
