export type CalendarBookingLike = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
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

export function applyOperationalWindowsToCalendarBookings<T extends CalendarBookingLike>(
  bookings: T[],
  windows: OperationalWindowLike[],
): Array<CalendarBookingWithOperationalWindow<T>> {
  const byBookingId = new Map(windows.map((window) => [window.bookingId, window]));

  return bookings.map((booking) => {
    const window = byBookingId.get(booking.id);
    if (!window) return booking;

    return {
      ...booking,
      actualStartsAt: booking.startsAt,
      actualEndsAt: booking.endsAt,
      startsAt: window.startsAt,
      endsAt: inclusiveOperationalEnd(window),
      operationalWindowSource: window.source,
    };
  });
}
