"use client";

import type { MapViewportTarget } from "@/features/routes/map-focus";
import { UTAH_DEFAULT_VIEW } from "@/features/routes/manager-map-navigation";
import { ManagerRouteMapLayers, type FocusedTripMapData } from "./manager-route-map-layers";
import { ManagerRouteMapShell } from "./manager-route-map-shell";

export type TripRouteStop = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  sortOrder: number;
};

type Props = {
  start?: { label: string; latitude: number | null; longitude: number | null };
  end?: { label: string; latitude: number | null; longitude: number | null };
  stops: TripRouteStop[];
};

function buildTrip(start: Props["start"], end: Props["end"], stops: TripRouteStop[]): FocusedTripMapData {
  const points: FocusedTripMapData["points"] = [];
  if (start?.latitude != null && start.longitude != null) {
    points.push({ id: "start", label: start.label, latitude: start.latitude, longitude: start.longitude });
  }
  [...stops]
    .filter((stop) => stop.latitude != null && stop.longitude != null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((stop) => {
      points.push({
        id: stop.id,
        label: stop.name,
        latitude: stop.latitude!,
        longitude: stop.longitude!,
      });
    });
  if (end?.latitude != null && end.longitude != null) {
    points.push({ id: "end", label: end.label, latitude: end.latitude, longitude: end.longitude });
  }
  return { id: "trip-detail", name: "Trip route", points };
}

function tripViewport(trip: FocusedTripMapData): MapViewportTarget {
  if (trip.points.length === 1) {
    const point = trip.points[0]!;
    return { kind: "center", center: [point.longitude, point.latitude], zoom: 10 };
  }
  if (trip.points.length > 1) {
    return {
      kind: "bounds",
      coordinates: trip.points.map((point) => [point.longitude, point.latitude]),
    };
  }
  return { kind: "center", center: UTAH_DEFAULT_VIEW.center, zoom: UTAH_DEFAULT_VIEW.zoom };
}

export function TripRouteMap({ start, end, stops }: Props) {
  const trip = buildTrip(start, end, stops);
  const viewport = tripViewport(trip);

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <ManagerRouteMapShell viewport={viewport}>
          <ManagerRouteMapLayers
            events={[]}
            handoffs={[]}
            focusedEventId={null}
            managerMode="planning"
            focusedTrip={trip}
          />
        </ManagerRouteMapShell>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">1</span>
          Start / first mapped point
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">2</span>
          Ordered trip stop
        </span>
      </div>
    </div>
  );
}
