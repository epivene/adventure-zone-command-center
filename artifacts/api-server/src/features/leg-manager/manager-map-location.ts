import type { GeocodingProvider } from "@/features/trips/geocoding";

type ManagerMapEvent = {
  bookingId: string;
  bookingName: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
};

function hasCoordinates(event: ManagerMapEvent) {
  return event.latitude !== null && event.longitude !== null && Number.isFinite(event.latitude) && Number.isFinite(event.longitude);
}

function locationLabel(event: ManagerMapEvent) {
  const city = event.city?.trim();
  const region = event.region?.trim();
  if (city && region) return `${city}, ${region}`;
  if (city) return city;
  return null;
}

export async function resolveManagerMapEventLocations<T extends ManagerMapEvent>(
  events: T[],
  geocoder: Pick<GeocodingProvider, "geocode">,
): Promise<T[]> {
  return Promise.all(events.map(async (event) => {
    if (hasCoordinates(event)) return event;
    const label = locationLabel(event);
    if (!label) return event;

    try {
      const first = (await geocoder.geocode(label))[0];
      if (!first) return event;
      return { ...event, latitude: first.latitude, longitude: first.longitude };
    } catch {
      return event;
    }
  }));
}
