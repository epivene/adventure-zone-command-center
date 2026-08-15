import type {
  MapEvent,
  LocationQuality,
  RouteMappingState,
} from "./map-data";
import type { GeocodingProvider } from "@/features/trips/geocoding";
import { GeocodingUnavailableError } from "@/features/trips/geocoding";

export type ResolvedMapLocation = {
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  quality: LocationQuality;
  mappingState: RouteMappingState;
};

type CachedLocation =
  | {
      kind: "success";
      latitude: number;
      longitude: number;
      displayName: string;
    }
  | { kind: "no_results" };

const locationCache = new Map<string, CachedLocation>();

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

function successState(event: MapEvent): RouteMappingState {
  return event.locationQuality === "address" ? "mapped_address" : "mapped_city";
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
      mappingState: "mapped_coordinates",
    };
  }

  if (!label) {
    return {
      latitude: null,
      longitude: null,
      label: null,
      quality: "missing",
      mappingState: "needs_mapping_missing_location",
    };
  }

  const cacheKey = label.trim().toLowerCase();
  const cached = locationCache.get(cacheKey);
  if (cached) {
    if (cached.kind === "no_results") {
      return {
        latitude: null,
        longitude: null,
        label,
        quality: "missing",
        mappingState: "needs_mapping_no_results",
      };
    }
    return {
      latitude: cached.latitude,
      longitude: cached.longitude,
      label,
      quality: event.locationQuality === "address" ? "address" : "city",
      mappingState: successState(event),
    };
  }

  try {
    const results = await geocoder.geocode(label);
    const first = results[0];
    if (!first) {
      locationCache.set(cacheKey, { kind: "no_results" });
      return {
        latitude: null,
        longitude: null,
        label,
        quality: "missing",
        mappingState: "needs_mapping_no_results",
      };
    }

    locationCache.set(cacheKey, {
      kind: "success",
      latitude: first.latitude,
      longitude: first.longitude,
      displayName: first.displayName,
    });
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      label,
      quality: event.locationQuality === "address" ? "address" : "city",
      mappingState: successState(event),
    };
  } catch (error) {
    if (error instanceof GeocodingUnavailableError) {
      if (error.code === "no_results") {
        locationCache.set(cacheKey, { kind: "no_results" });
        return {
          latitude: null,
          longitude: null,
          label,
          quality: "missing",
          mappingState: "needs_mapping_no_results",
        };
      }
      return {
        latitude: null,
        longitude: null,
        label,
        quality: "missing",
        mappingState: "needs_mapping_provider_unavailable",
      };
    }

    return {
      latitude: null,
      longitude: null,
      label,
      quality: "missing",
      mappingState: "needs_mapping_provider_unavailable",
    };
  }
}

export async function resolveRouteMapEvents(
  events: MapEvent[],
  geocoder: GeocodingProvider,
): Promise<MapEvent[]> {
  const resolved: MapEvent[] = [];

  for (const event of events) {
    if (!event.travelLegId) {
      resolved.push({
        ...event,
        mappingState:
          event.mappingState ??
          (validCoordinatePair(event)
            ? "mapped_coordinates"
            : routeLocationLabel(event)
              ? "needs_mapping_no_results"
              : "needs_mapping_missing_location"),
      });
      continue;
    }

    const location = await resolveMapLocation(event, geocoder);
    resolved.push({
      ...event,
      latitude: location.latitude,
      longitude: location.longitude,
      locationLabel: location.label,
      locationQuality: location.quality,
      mappingState: location.mappingState,
      seasonYear: event.seasonYear ?? event.startsAt?.getUTCFullYear() ?? null,
    });
  }

  return resolved;
}

export function invalidateRouteLocationCache(label: string) {
  locationCache.delete(label.trim().toLowerCase());
}

export function clearRouteLocationCacheForTests() {
  locationCache.clear();
}
