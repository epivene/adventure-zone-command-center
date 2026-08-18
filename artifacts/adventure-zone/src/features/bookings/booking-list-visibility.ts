export type BookingDateWindow = {
  startsAt: Date | null;
  endsAt: Date | null;
};

const SENTINEL_YEAR = 9999;

export function normalizedBookingEnd(value: Date | null): Date | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.getUTCFullYear() >= SENTINEL_YEAR ? null : value;
}

export function isBookingCurrentOrFuture(
  booking: BookingDateWindow,
  now = new Date(),
): boolean {
  const start = booking.startsAt;
  const end = normalizedBookingEnd(booking.endsAt);

  if (end) return end.getTime() >= now.getTime();
  if (start) return start.getTime() >= now.getTime();
  return true;
}
