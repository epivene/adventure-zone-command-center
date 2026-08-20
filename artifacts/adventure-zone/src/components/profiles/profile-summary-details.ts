type MailingPlace = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};

type VenueBooking = {
  name: string;
  venueName?: string | null;
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  startsAt?: Date | string | null;
};

function cityLine(city?: string | null, region?: string | null, postalCode?: string | null) {
  const cityRegion = [city, region].filter(Boolean).join(", ");
  return [cityRegion, postalCode].filter(Boolean).join(" ");
}

function addressText(address1?: string | null, address2?: string | null, city?: string | null, region?: string | null, postalCode?: string | null) {
  return [address1, address2, cityLine(city, region, postalCode)].filter(Boolean).join("\n");
}

function asTime(value: VenueBooking["startsAt"]) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function profileSummaryDetails(input: {
  now?: Date;
  place: MailingPlace;
  bookings: VenueBooking[];
}) {
  const now = (input.now ?? new Date()).getTime();
  const timed = input.bookings
    .map((booking) => ({ booking, time: asTime(booking.startsAt) }))
    .filter((entry): entry is { booking: VenueBooking; time: number } => entry.time !== null);

  const upcoming = timed
    .filter((entry) => entry.time >= now)
    .sort((left, right) => left.time - right.time)[0]?.booking;
  const mostRecent = timed
    .filter((entry) => entry.time < now)
    .sort((left, right) => right.time - left.time)[0]?.booking;
  const fallback = input.bookings[0];
  const venue = upcoming ?? mostRecent ?? fallback ?? null;

  return {
    mailingAddress: addressText(
      input.place.address1,
      input.place.address2,
      input.place.city,
      input.place.region,
      input.place.postalCode,
    ),
    venueLabel: venue?.venueName?.trim() || null,
    venueAddress: venue
      ? addressText(venue.address1, null, venue.city, venue.region, venue.postalCode)
      : "",
    venueBookingName: venue?.name ?? null,
  };
}
