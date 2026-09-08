import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";
import type { RouteBucket } from "@/features/routes/route-view";
import { businessDateKey, parseBusinessDate } from "@/lib/business-date";

export type LocationQuality = "coordinates" | "address" | "city" | "missing";
export type TravelLegAssignmentKind = "assigned" | "suggested" | null;
export type LegAssignmentWarning = "long_travel" | "major_travel_concern" | null;

export type RouteMappingState =
  | "mapped_coordinates"
  | "mapped_address"
  | "mapped_city"
  | "needs_mapping_no_results"
  | "needs_mapping_provider_unavailable"
  | "needs_mapping_missing_location";

export type MapEvent = {
  id: string;
  organizationId?: string | null;
  name: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  status: BookingStatus;
  probability: Probability;
  travelLegId: string | null;
  travelLegName: string | null;
  travelLegColor: string | null;
  travelLegAssignmentKind?: TravelLegAssignmentKind;
  legAssignmentWarning?: LegAssignmentWarning;
  legAssignmentExplanation?: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  routeBucket?: RouteBucket;
  locationQuality?: LocationQuality;
  locationLabel?: string | null;
  mappingState?: RouteMappingState;
  seasonYear?: number | null;
};

export type MapFilters = {
  statuses: MapEvent["status"][];
  travelLegIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
  regions: string[];
};

export type MapFeatureProperties = {
  id: string;
  organizationId?: string | null;
  name: string;
  status: MapEvent["status"];
  probability: MapEvent["probability"];
  travelLegId: string | null;
  travelLegColor: string | null;
  travelLegAssignmentKind?: TravelLegAssignmentKind;
  legAssignmentWarning?: LegAssignmentWarning;
  legAssignmentExplanation?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  routeBucket?: RouteBucket;
  locationQuality?: LocationQuality;
  locationLabel?: string | null;
  mappingState?: RouteMappingState;
  seasonYear?: number | null;
  emphasis?: "primary" | "dimmed";
};

export type MapFeature = {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: MapFeatureProperties;
};

export type MapFeatureCollection = {
  type: "FeatureCollection";
  features: MapFeature[];
};

export type MapDataset = {
  geoJson: MapFeatureCollection;
  unmappedEvents: MapEvent[];
};

const emptyFilters: MapFilters = {
  statuses: [],
  travelLegIds: [],
  dateFrom: null,
  dateTo: null,
  regions: [],
};

function validBusinessDate(value: string | null): string | null {
  return value && parseBusinessDate(value) ? value : null;
}

export function eventOverlapsBusinessWindow(
  event: Pick<MapEvent, "startsAt" | "endsAt">,
  from: string | null,
  to: string | null,
): boolean {
  if (!event.startsAt) return false;
  const startsOn = businessDateKey(event.startsAt);
  const endsOn = businessDateKey(event.endsAt ?? event.startsAt);
  if (from !== null && endsOn < from) return false;
  if (to !== null && startsOn > to) return false;
  return true;
}

export function filterMapEvents(
  events: MapEvent[],
  filters: MapFilters = emptyFilters,
): MapEvent[] {
  const from = validBusinessDate(filters.dateFrom);
  const to = validBusinessDate(filters.dateTo);

  return events.filter((event) => {
    if (filters.statuses.length && !filters.statuses.includes(event.status)) {
      return false;
    }
    if (
      filters.travelLegIds.length &&
      (!event.travelLegId || !filters.travelLegIds.includes(event.travelLegId))
    ) {
      return false;
    }
    if (filters.regions.length && !filters.regions.includes(event.region)) {
      return false;
    }
    if (
      (from !== null || to !== null) &&
      !eventOverlapsBusinessWindow(event, from, to)
    ) {
      return false;
    }
    return true;
  });
}

function hasValidCoordinates(
  event: MapEvent,
): event is MapEvent & { latitude: number; longitude: number } {
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

export function toMapDataset(events: MapEvent[]): MapDataset {
  const mappedEvents = events.filter(hasValidCoordinates);
  const unmappedEvents = events.filter((event) => !hasValidCoordinates(event));

  return {
    geoJson: {
      type: "FeatureCollection",
      features: mappedEvents.map((event) => ({
        type: "Feature",
        id: event.id,
        geometry: {
          type: "Point",
          coordinates: [event.longitude, event.latitude],
        },
        properties: {
          id: event.id,
          organizationId: event.organizationId,
          name: event.name,
          status: event.status,
          probability: event.probability,
          travelLegId: event.travelLegId,
          travelLegColor: event.travelLegColor,
          travelLegAssignmentKind: event.travelLegAssignmentKind,
          legAssignmentWarning: event.legAssignmentWarning,
          legAssignmentExplanation: event.legAssignmentExplanation,
          startsAt: event.startsAt?.toISOString() ?? null,
          endsAt: event.endsAt?.toISOString() ?? null,
          routeBucket: event.routeBucket,
          locationQuality: event.locationQuality,
          locationLabel: event.locationLabel,
          mappingState: event.mappingState,
          seasonYear: event.seasonYear,
        },
      })),
    },
    unmappedEvents,
  };
}
