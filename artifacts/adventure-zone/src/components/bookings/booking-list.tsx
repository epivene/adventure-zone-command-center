"use client";

import { Link } from "wouter";
import { useState } from "react";

import { StatusBadge } from "@/components/bookings/status-badge";
import type { BookingListRecord } from "@/features/bookings/booking-repository";
import {
  bookingStatusValues,
  probabilityValues,
} from "@/features/bookings/booking-types";
import {
  BUSINESS_TIME_ZONE,
  businessDateKey,
  classifyBusinessDueDate,
} from "@/lib/business-date";

export type BookingListItem = BookingListRecord;

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function BookingList({
  bookings,
  now = new Date(),
}: {
  bookings: BookingListItem[];
  now?: Date;
}) {
  const [status, setStatus] = useState("");
  const [probability, setProbability] = useState("");
  const [region, setRegion] = useState("");
  const [travelLegId, setTravelLegId] = useState("");
  const [startsAfter, setStartsAfter] = useState("");
  const [startsBefore, setStartsBefore] = useState("");

  const regions = [...new Set(bookings.map((booking) => booking.region))].sort();
  const travelLegs = [
    ...new Map(
      bookings
        .filter((booking) => booking.travelLeg)
        .map((booking) => [booking.travelLeg!.id, booking.travelLeg!]),
    ).values(),
  ];

  const filteredBookings = bookings.filter((booking) => {
    if (status && booking.status !== status) return false;
    if (probability && booking.probability !== probability) return false;
    if (region && booking.region !== region) return false;
    if (travelLegId && booking.travelLeg?.id !== travelLegId) return false;
    if (
      startsAfter &&
      (!booking.startsAt ||
        businessDateKey(booking.startsAt) < startsAfter)
    ) {
      return false;
    }
    if (
      startsBefore &&
      (!booking.startsAt ||
        businessDateKey(booking.startsAt) > startsBefore)
    ) {
      return false;
    }
    return true;
  });

  function resetFilters() {
    setStatus("");
    setProbability("");
    setRegion("");
    setTravelLegId("");
    setStartsAfter("");
    setStartsBefore("");
  }

  return (
    <div className="grid gap-5">
      <section
        aria-label="Booking filters"
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-6"
      >
        <label className="grid gap-1 text-sm font-semibold">
          Booking status
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="">All statuses</option>
            {bookingStatusValues.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Probability
          <select
            onChange={(event) => setProbability(event.target.value)}
            value={probability}
          >
            <option value="">All probabilities</option>
            {probabilityValues.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          State
          <select onChange={(event) => setRegion(event.target.value)} value={region}>
            <option value="">All states</option>
            {regions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Travel leg
          <select
            onChange={(event) => setTravelLegId(event.target.value)}
            value={travelLegId}
          >
            <option value="">All travel legs</option>
            {travelLegs.map((leg) => (
              <option key={leg.id} value={leg.id}>
                {leg.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Starts after
          <input
            onChange={(event) => setStartsAfter(event.target.value)}
            type="date"
            value={startsAfter}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Starts before
          <input
            onChange={(event) => setStartsBefore(event.target.value)}
            type="date"
            value={startsBefore}
          />
        </label>
        <div className="flex items-end sm:col-span-2 xl:col-span-6">
          <button className="button-secondary" onClick={resetFilters} type="button">
            Reset filters
          </button>
        </div>
      </section>

      <p aria-live="polite" className="text-sm text-slate-600">
        Showing {filteredBookings.length} of {bookings.length} bookings
      </p>

      {filteredBookings.length ? (
        <ul className="grid gap-3">
          {filteredBookings.map((booking) => {
            const isOverdue =
              booking.nextAction !== null &&
              classifyBusinessDueDate(booking.nextAction.dueAt, now) ===
                "overdue";
            return (
              <li
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                key={booking.id}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="text-lg font-bold text-slate-950 hover:text-orange-700"
                        href={`/bookings/${booking.id}`}
                      >
                        {booking.name}
                      </Link>
                      <StatusBadge status={booking.status} />
                      {isOverdue ? (
                        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">
                          Overdue
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      <span>
                        {booking.city}, {booking.region}
                      </span>
                      {booking.travelLeg ? (
                        <>
                          {" · "}
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: booking.travelLeg.color }}
                          />{" "}
                          {booking.travelLeg.name}
                        </>
                      ) : null}
                    </p>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:min-w-[34rem]">
                    <div>
                      <dt className="font-semibold text-slate-500">Dates</dt>
                      <dd>
                        {booking.startsAt ? formatShortDate(booking.startsAt) : "Not set"}
                        {booking.endsAt ? `–${formatShortDate(booking.endsAt)}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Probability</dt>
                      <dd>{formatLabel(booking.probability)}</dd>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <dt className="font-semibold text-slate-500">Next action</dt>
                      <dd className={isOverdue ? "font-semibold text-rose-700" : ""}>
                        {booking.nextAction
                          ? `${formatLabel(booking.nextAction.kind)} · ${formatShortDate(
                              booking.nextAction.dueAt,
                            )}`
                          : "Needs follow-up plan"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold">No bookings match these filters.</p>
          <button className="button-secondary mt-3" onClick={resetFilters} type="button">
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}
