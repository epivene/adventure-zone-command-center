import type { MapEvent } from "./map-data";
import { classifyRouteBucket, routeEmphasis, type RouteViewMode } from "./route-view";

export type MapViewportTarget =
  | { kind: "center"; center: [number, number]; zoom: number }
  | { kind: "bounds"; coordinates: [number, number][] }
  | { kind: "none" };

function hasCoordinates(event: MapEvent): event is MapEvent & { latitude: number; longitude: number } {
  return event.latitude !== null && event.longitude !== null && Number.isFinite(event.latitude) && Number.isFinite(event.longitude);
}

export function primaryViewportEvents(
  events: MapEvent[],
  mode: RouteViewMode,
  focusedLegId: string | null,
) {
  return events.filter((event) => {
    if (!hasCoordinates(event)) return false;
    const bucket = event.routeBucket ?? classifyRouteBucket(event.status, event.probability);
    return routeEmphasis({ bucket, mode, eventLegId: event.travelLegId, focusedLegId }) === "primary";
  });
}

export function viewportTarget(input: {
  primaryEvents: MapEvent[];
  explicitEventId: string | null;
  tripCoordinates: [number, number][] | null;
}): MapViewportTarget {
  const { primaryEvents, explicitEventId, tripCoordinates } = input;
  if (explicitEventId) {
    const event = primaryEvents.find((candidate) => candidate.id === explicitEventId);
    if (event && hasCoordinates(event)) {
      return { kind: "center", center: [event.longitude, event.latitude], zoom: 11 };
    }
  }
  if (tripCoordinates && tripCoordinates.length === 1) {
    return { kind: "center", center: tripCoordinates[0]!, zoom: 10 };
  }
  if (tripCoordinates && tripCoordinates.length > 1) {
    return { kind: "bounds", coordinates: tripCoordinates };
  }
  const mapped = primaryEvents.filter(hasCoordinates);
  if (mapped.length === 0) {
    return { kind: "none" };
  }
  if (mapped.length === 1) {
    const event = mapped[0]!;
    return { kind: "center", center: [event.longitude, event.latitude], zoom: 10 };
  }
  return { kind: "bounds", coordinates: mapped.map((event) => [event.longitude, event.latitude]) };
}

export function routeScopeSummary(input: {
  mode: RouteViewMode;
  seasonYear: number;
  focusedLegName: string | null;
  region: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const parts: string[] = [];
  if (input.focusedLegName) parts.push(input.focusedLegName);
  if (input.mode !== "full") parts.push(`${input.mode[0]!.toUpperCase()}${input.mode.slice(1)}`);
  parts.push(String(input.seasonYear));
  if (input.region) parts.push(input.region);
  if (input.dateFrom && input.dateTo) parts.push(`${input.dateFrom}–${input.dateTo}`);
  else if (input.dateFrom) parts.push(`after ${input.dateFrom}`);
  else if (input.dateTo) parts.push(`before ${input.dateTo}`);
  return `Showing ${parts.join(" · ")}`;
}
