export type CalendarBookingLike = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
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
