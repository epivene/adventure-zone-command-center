"use client";

import { Link } from "wouter";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { StatusBadge } from "@/components/bookings/status-badge";
import type { BookingListRecord } from "@/features/bookings/booking-repository";
import {
  bookingStatusValues,
  probabilityValues,
  type BookingStatus,
} from "@/features/bookings/booking-types";
import {
  isBookingCurrentOrFuture,
  normalizedBookingEnd,
} from "@/features/bookings/booking-list-visibility";
import {
  BUSINESS_TIME_ZONE,
  businessDateKey,
  classifyBusinessDueDate,
} from "@/lib/business-date";
import { groupBookingsByProfile } from "@/features/bookings/booking-list-grouping";

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

function latestBooking(bookings: BookingListItem[]) {
  return bookings.reduce<BookingListItem | null>((latest, booking) => {
    if (!latest) return booking;
    const latestTime = latest.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bookingTime = booking.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    return bookingTime >= latestTime ? booking : latest;
  }, null);
}

export function BookingList({
  bookings: suppliedBookings,
  now = new Date(),
  initialStatus = "",
  initialShowPast = false,
}: {
  bookings: BookingListItem[];
  now?: Date;
  initialStatus?: BookingStatus | "";
  initialShowPast?: boolean;
}) {
  const bookings = suppliedBookings.map(booking => booking.dateProvenance ? {
    ...booking,
    startsAt:booking.dateProvenance.publicWindow ? new Date(booking.dateProvenance.publicWindow.start) : null,
    endsAt:booking.dateProvenance.publicWindow ? new Date(new Date(booking.dateProvenance.publicWindow.end).getTime()-(booking.dateProvenance.publicEndExclusive?1:0)) : null,
  } : booking);
  const [status, setStatus] = useState(initialStatus);
  const [probability, setProbability] = useState("");
  const [region, setRegion] = useState("");
  const [travelLegId, setTravelLegId] = useState("");
  const [startsAfter, setStartsAfter] = useState("");
  const [startsBefore, setStartsBefore] = useState("");
  const [showPast, setShowPast] = useState(initialShowPast);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

  const regions = [...new Set(bookings.map((booking) => booking.region))].sort();
  const travelLegs = [
    ...new Map(
      bookings
        .filter((booking) => booking.travelLeg)
        .map((booking) => [booking.travelLeg!.id, booking.travelLeg!]),
    ).values(),
  ];

  const currentBookings = bookings.filter((booking) => isBookingCurrentOrFuture(booking, now));
  const visibleBase = showPast ? bookings : currentBookings;

  const filteredBookings = visibleBase.filter((booking) => {
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
  const groupedBookings = groupBookingsByProfile(filteredBookings);

  function resetFilters() {
    setStatus("");
    setProbability("");
    setRegion("");
    setTravelLegId("");
    setStartsAfter("");
    setStartsBefore("");
    setShowPast(false);
  }

  return (
    <div className="grid gap-5">
      <section
        aria-label="Booking filters"
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-6"
      >
        <label className="grid gap-1 text-sm font-semibold">
          Booking status
          <select onChange={(event) => setStatus(event.target.value as BookingStatus | "")} value={status}>
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
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2 xl:col-span-6">
          <button className="button-secondary" onClick={resetFilters} type="button">
            Reset filters
          </button>
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            <input
              checked={showPast}
              onChange={(event) => setShowPast(event.target.checked)}
              type="checkbox"
            />
            Show past bookings
          </label>
        </div>
      </section>

      <p aria-live="polite" className="text-sm text-slate-600">
        Showing {groupedBookings.length} event {groupedBookings.length === 1 ? "profile" : "profiles"} with{" "}
        {filteredBookings.length} of {visibleBase.length} {showPast ? "booking records" : "current/upcoming booking records"}
      </p>

      {filteredBookings.length ? (
        <ul className="grid gap-3">
          {groupedBookings.map((group) => (
            <BookingProfileGroupCard
              group={group}
              expanded={expandedGroups.has(group.key)}
              onToggle={() => setExpandedGroups((current) => {
                const next = new Set(current);
                if (next.has(group.key)) next.delete(group.key);
                else next.add(group.key);
                return next;
              })}
              key={group.key}
            />
          ))}
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

function BookingProfileGroupCard({
  group,
  expanded,
  onToggle,
}: {
  group: ReturnType<typeof groupBookingsByProfile>[number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const latest = latestBooking(group.bookings);
  if (!latest) return null;
  const displayEnd = normalizedBookingEnd(latest.endsAt);

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        aria-controls={`booking-history-${group.key}`}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-4 bg-muted/40 px-4 py-4 text-left transition-colors hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset"
        onClick={onToggle}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-bold text-card-foreground">
            {group.profile?.name ?? latest.name}
          </span>
          <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.bookings.length} booking {group.bookings.length === 1 ? "record" : "records"} · latest booking
          </span>
          <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-bold text-card-foreground">{latest.name}</span>
            <StatusBadge status={latest.status} />
            <span className="text-muted-foreground">{latest.city}, {latest.region}</span>
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {latest.startsAt ? formatShortDate(latest.startsAt) : "Date not set"}
            {displayEnd ? `–${formatShortDate(displayEnd)}` : ""}
            {latest.travelLeg ? ` · ${latest.travelLeg.name}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          <span className="hidden text-xs font-semibold sm:inline">{expanded ? "Hide history" : "View history"}</span>
          <ChevronDown className={`h-5 w-5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded ? (
        <div id={`booking-history-${group.key}`} className="border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-card px-4 py-3">
            <p className="text-sm font-semibold text-muted-foreground">All bookings under this profile</p>
            {group.profile ? (
              <Link className="button-secondary text-center" href={`/profiles/${group.profile.id}`}>
                Open event profile
              </Link>
            ) : null}
          </div>
          <ul className="divide-y divide-border">
                {group.bookings.map((booking) => {
                  const isOverdue =
                    booking.nextAction !== null &&
                    classifyBusinessDueDate(booking.nextAction.dueAt, now) === "overdue";
                  const displayEnd = normalizedBookingEnd(booking.endsAt);
                  return (
                    <li className="p-4" key={booking.id}>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link className="font-bold text-card-foreground hover:text-primary" href={`/bookings/${booking.id}`}>
                              {booking.name}
                            </Link>
                            <StatusBadge status={booking.status} />
                            {isOverdue ? (
                              <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive">
                                Overdue
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            <span>{booking.city}, {booking.region}</span>
                            {booking.travelLeg ? (
                              <>
                                {" · "}
                                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: booking.travelLeg.color }} />{" "}
                                {booking.travelLeg.name}
                              </>
                            ) : null}
                          </p>
                        </div>

                        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:min-w-[34rem]">
                          <div>
                            <dt className="font-semibold text-muted-foreground">Dates</dt>
                            <dd>
                              {booking.startsAt ? formatShortDate(booking.startsAt) : "Not set"}
                              {displayEnd ? `–${formatShortDate(displayEnd)}` : ""}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-muted-foreground">Probability</dt>
                            <dd>{formatLabel(booking.probability)}</dd>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <dt className="font-semibold text-muted-foreground">Next action</dt>
                            <dd className={isOverdue ? "font-semibold text-destructive" : ""}>
                              {booking.nextAction
                                ? `${formatLabel(booking.nextAction.kind)} · ${formatShortDate(booking.nextAction.dueAt)}`
                                : "Needs follow-up plan"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </li>
                  );
                })}
              </ul>
        </div>
      ) : null}
    </li>
  );
}
