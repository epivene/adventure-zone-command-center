export type ProfileOwnedBooking = {
  id: string;
  name: string;
  organization: { id: string; name: string } | null;
};

export type BookingProfileGroup<T extends ProfileOwnedBooking> = {
  key: string;
  profile: { id: string; name: string } | null;
  bookings: T[];
};

export function groupBookingsByProfile<T extends ProfileOwnedBooking>(
  bookings: T[],
): BookingProfileGroup<T>[] {
  const groups = new Map<string, BookingProfileGroup<T>>();

  for (const booking of bookings) {
    const key = booking.organization
      ? `profile:${booking.organization.id}`
      : `booking:${booking.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.bookings.push(booking);
      continue;
    }
    groups.set(key, {
      key,
      profile: booking.organization,
      bookings: [booking],
    });
  }

  return [...groups.values()];
}