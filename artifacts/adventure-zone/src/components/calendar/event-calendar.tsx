"use client";

import { Link } from "wouter";
import { useMemo, useState } from "react";

import type { MapEvent } from "@/features/routes/map-data";
import {
  BUSINESS_TIME_ZONE,
  businessDateKey,
} from "@/lib/business-date";

type CalendarView = "month" | "agenda";

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

function EventLink({ event, compact = false }: { event: MapEvent; compact?: boolean }) {
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
      <span className={`block font-bold text-slate-950 ${compact ? "text-xs" : "text-sm"}`}>
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

export function EventCalendar({
  events,
  initialMonth = businessDateKey(new Date()).slice(0, 7),
}: {
  events: MapEvent[];
  initialMonth?: string;
}) {
  const [view, setView] = useState<CalendarView>("month");
  const [activeMonth, setActiveMonth] = useState(() => parseMonth(initialMonth));
  const datedEvents = useMemo(
    () =>
      events
        .filter((event): event is MapEvent & { startsAt: Date } => event.startsAt !== null)
        .sort(
          (left, right) =>
            left.startsAt.getTime() - right.startsAt.getTime() ||
            left.id.localeCompare(right.id),
        ),
    [events],
  );

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
    const groups = new Map<string, typeof datedEvents>();
    for (const event of datedEvents) {
      const key = businessDateKey(event.startsAt).slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.entries()];
  }, [datedEvents]);

  function moveMonth(change: number) {
    setActiveMonth(
      (current) =>
        new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + change, 1)),
    );
  }

  return (
    <section className="grid gap-4" aria-label="Event calendar">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
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
              const dayEvents = datedEvents.filter(
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
                    {dayEvents.map((event) => (
                      <EventLink compact event={event} key={event.id} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : agendaGroups.length ? (
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
                    <EventLink event={event} />
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
    </section>
  );
}
