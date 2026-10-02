import type { ResolvedDates } from "../../booking-date-repair/date-evidence";
export type CalendarBookingLike = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  dateProvenance?: ResolvedDates;
  status?: string | null;
  probability?: string | null;
  [key: string]: unknown;
};

export type OperationalWindowLike = {
  bookingId: string;
  startsAt: Date;
  /** Stored using Google all-day semantics: exclusive end. */
  endsAt: Date;
  source: "app" | "google_calendar" | "manual" | string;
};

export type CalendarBookingWithOperationalWindow<T extends CalendarBookingLike> = T & {
  actualStartsAt?: Date | null;
  actualEndsAt?: Date | null;
  operationalWindowSource?: string;
};

function inclusiveOperationalEnd(window: OperationalWindowLike) {
  const end = new Date(window.endsAt);
  if (window.source === 'reviewed_timestamp') return end;
  if (end.getTime() <= window.startsAt.getTime()) return new Date(window.startsAt);
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isDefiniteBooking(booking: CalendarBookingLike) {
  const status = normalized(booking.status);
  return normalized(booking.probability) === "definite"
    || status === "contract_received"
    || status === "confirmed"
    || status === "completed";
}

function isSameDateAppPlaceholder(booking: CalendarBookingLike, window: OperationalWindowLike) {
  if (window.source !== "app" || !booking.startsAt) return false;
  const actualEnd = booking.endsAt ?? booking.startsAt;
  return dateKey(window.startsAt) === dateKey(booking.startsAt)
    && dateKey(window.endsAt) === dateKey(actualEnd);
}

function applyDefaultDefiniteWindow<T extends CalendarBookingLike>(
  booking: T,
): CalendarBookingWithOperationalWindow<T> {
  const actualStart = booking.startsAt!;
  const actualEnd = booking.endsAt ?? actualStart;
  return {
    ...booking,
    actualStartsAt: actualStart,
    actualEndsAt: booking.endsAt,
    startsAt: addUtcDays(actualStart, -2),
    endsAt: addUtcDays(actualEnd, 1),
    operationalWindowSource: "app",
  };
}

export function applyOperationalWindowsToCalendarBookings<T extends CalendarBookingLike>(
  bookings: T[],
  windows: OperationalWindowLike[],
): Array<CalendarBookingWithOperationalWindow<T>> {
  const byBookingId = new Map(windows.map((window) => [window.bookingId, window]));

  return bookings.map((booking) => {
    if (booking.dateProvenance) {
      const dates=booking.dateProvenance, chosen=dates.reservationWindow ?? dates.publicWindow;
      const exclusive=dates.reservationWindow ? dates.reservationEndExclusive : dates.publicEndExclusive;
      return { ...booking, actualStartsAt: dates.publicWindow ? new Date(dates.publicWindow.start) : null, actualEndsAt: dates.publicWindow ? new Date(new Date(dates.publicWindow.end).getTime()-(dates.publicEndExclusive?1:0)) : null, startsAt: chosen ? new Date(chosen.start) : null, endsAt: chosen ? new Date(new Date(chosen.end).getTime()-(exclusive?1:0)) : null, dateOnly:false, actualDateOnly:false, operationalWindowSource:dates.reservationWindow ? "reviewed_timestamp" : "verified_public" };
    }
    const window = byBookingId.get(booking.id);
    if (
      booking.startsAt
      && isDefiniteBooking(booking)
      && (!window || isSameDateAppPlaceholder(booking, window))
    ) {
      return applyDefaultDefiniteWindow(booking);
    }
    if (!window) return booking;

    return {
      ...booking,
      actualDateOnly: booking.dateOnly,
      dateOnly: window.source === "google_calendar" || booking.dateOnly,
      actualStartsAt: booking.startsAt,
      actualEndsAt: booking.endsAt,
      startsAt: window.startsAt,
      endsAt: inclusiveOperationalEnd(window),
      operationalWindowSource: window.source,
    };
  });
}
