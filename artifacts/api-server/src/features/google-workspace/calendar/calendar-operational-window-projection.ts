export type CalendarBookingLike = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  [key: string]: unknown;
};

export type OperationalWindowLike = {
  bookingId: string;
  startsAt: Date;
  endsAt: Date;
  source: "app" | "google_calendar" | "manual" | string;
};

export type CalendarBookingWithOperationalWindow<T extends CalendarBookingLike> = T & {
  actualStartsAt?: Date | null;
  actualEndsAt?: Date | null;
  operationalWindowSource?: string;
};

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
      endsAt: window.endsAt,
      operationalWindowSource: window.source,
    };
  });
}
