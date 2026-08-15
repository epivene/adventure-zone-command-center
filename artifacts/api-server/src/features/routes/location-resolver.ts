import type { MapEvent, LocationQuality } from "./map-data";
import type { GeocodingProvider } from "@/features/trips/geocoding";
import { GeocodingUnavailableError } from "@/features/trips/geocoding";

export type ResolvedMapLocation = {
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  quality: LocationQuality;
};

type CachedLocation = {
  latitude: number;
  longitude: number;
  displayName: string;
};

const locationCache = new Map<string, CachedLocation | null>();

function validCoordinatePair(event: Pick<MapEvent, "latitude" | "longitude">) {
  return (
    event.latitude !== null &&
    event.longitude !== null &&
    Number.isFinite(event.latitude) &&
    Number.isFinite(event.longitude) &&
    event.latitude >= -90 &&
    event.latitude <= 90 &&
    event.longitude >= -180 &&
    event.longitude <= 180
  );
}

export function routeLocationLabel(event: MapEvent): string | null {
  const explicit = event.locationLabel?.trim();
  if (explicit) return explicit;

  const city = event.city?.trim();
  const region = event.region?.trim();
  if (city && region) return `${city}, ${region}`;
  if (city) return city;
  if (region) return region;
  return null;
}

export async function resolveMapLocation(
  event: MapEvent,
  geocoder: GeocodingProvider,
): Promise<ResolvedMapLocation> {
  const label = routeLocationLabel(event);

  if (validCoordinatePair(event)) {
    return {
      latitude: event.latitude,
      longitude: event.longitude,
      label,
      quality: "coordinates",
    };
  }

  if (!label) {
    return {
      latitude: null,
      longitude: null,
      label: null,
      quality: "missing",
    };
  }

  const cacheKey = label.toLowerCase();
  if (locationCache.has(cacheKey)) {
    const cached = locationCache.get(cacheKey) ?? null;
    return cached
      ? {
          latitude: cached.latitude,
          longitude: cached.longitude,
          label,
          quality: event.locationQuality === "address" ? "address" : "city",
        }
      : { latitude: null, longitude: null, label, quality: "missing" };
  }

  try {
    const results = await geocoder.geocode(label);
    const first = results[0];
    if (!first) {
      locationCache.set(cacheKey, null);
      return { latitude: null, longitude: null, label, quality: "missing" };
    }
    locationCache.set(cacheKey, first);
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      label,
      quality: event.locationQuality === "address" ? "address" : "city",
    };
  } catch (error) {
    if (error instanceof GeocodingUnavailableError) {
      // Do not cache provider outages. A later request should be allowed to retry.
      if (error.code === "no_results") locationCache.set(cacheKey, null);
      return { latitude: null, longitude: null, label, quality: "missing" };
    }
    return { latitude: null, longitude: null, label, quality: "missing" };
  }
}

export async function resolveRouteMapEvents(
  events: MapEvent[],
  geocoder: GeocodingProvider,
): Promise<MapEvent[]> {
  const resolved: MapEvent[] = [];

  // Nominatim asks clients to make requests serially. The cache means repeated
  // city/state pairs cost only one lookup per server process.
  for (const event of events) {
    if (!event.travelLegId) {
      resolved.push(event);
      continue;
    }

    const location = await resolveMapLocation(event, geocoder);
    resolved.push({
      ...event,
      latitude: location.latitude,
      longitude: location.longitude,
      locationLabel: location.label,
      locationQuality: location.quality,
      seasonYear: event.seasonYear ?? event.startsAt?.getUTCFullYear() ?? null,
    });
  }

  return resolved;
}

export function clearRouteLocationCacheForTests() {
  locationCache.clear();
}
