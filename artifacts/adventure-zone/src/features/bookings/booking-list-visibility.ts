export type BookingDateWindow = {
  startsAt: Date | null;
  endsAt: Date | null;
  dateProvenance?: {publicWindow:{start:string;end:string}|null;reservationWindow:{start:string;end:string}|null;evidenceState:'verified'|'needs_review';publicEndExclusive?:boolean};
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
  if(booking.dateProvenance) {
    const dates=booking.dateProvenance;
    if(dates.evidenceState==='needs_review' || !dates.publicWindow) return true;
    return new Date(dates.publicWindow.end).getTime()-(dates.publicEndExclusive?1:0) >= now.getTime();
  }
  const start = booking.startsAt;
  const end = normalizedBookingEnd(booking.endsAt);

  if (end) return end.getTime() >= now.getTime();
  if (start) return start.getTime() >= now.getTime();
  return true;
}
