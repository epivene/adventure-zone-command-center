import { useMemo } from "react";
import { ManagerRouteMapShell } from "@/components/routes/manager-route-map-shell";
import { ManagerTripNavigationActions, type FocusedTripMapData } from "@/components/routes/manager-route-map-layers";
import type { MapViewportTarget } from "@/features/routes/map-focus";
import type { ManagerMapMode } from "@/features/routes/manager-map-navigation";
import type { ManagerMapVariant, ManagerScopedMapData } from "@/features/manager/manager-map-types";
import { ManagerScopedMapLayers } from "./manager-scoped-map-layers";

const UTAH: MapViewportTarget = { kind: "center", center: [-111.9, 40.2], zoom: 6 };

function viewportFor(data: ManagerScopedMapData, variant: ManagerMapVariant): MapViewportTarget {
  const coordinates: [number, number][] = [];
  if (variant === "operations" && data.route) {
    const { trip } = data.route;
    if (trip.startLatitude !== null && trip.startLongitude !== null) coordinates.push([trip.startLongitude, trip.startLatitude]);
    for (const stop of data.route.stops) if (stop.latitude !== null && stop.longitude !== null) coordinates.push([stop.longitude, stop.latitude]);
    if (trip.endLatitude !== null && trip.endLongitude !== null) coordinates.push([trip.endLongitude, trip.endLatitude]);
  } else {
    for (const event of data.events) if (event.latitude !== null && event.longitude !== null) coordinates.push([event.longitude, event.latitude]);
  }
  for (const meetup of data.meetups) coordinates.push([meetup.meetupLongitude, meetup.meetupLatitude]);
  if (!coordinates.length) return UTAH;
  if (coordinates.length === 1) return { kind: "center", center: coordinates[0]!, zoom: 9 };
  return { kind: "bounds", coordinates };
}

function tripData(data: ManagerScopedMapData): FocusedTripMapData | null {
  if (!data.route) return null;
  const points: FocusedTripMapData["points"] = [];
  const { trip } = data.route;
  if (trip.startLatitude !== null && trip.startLongitude !== null) points.push({ id: `${trip.id}:start`, label: trip.startLabel, latitude: trip.startLatitude, longitude: trip.startLongitude });
  for (const stop of [...data.route.stops].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (stop.latitude !== null && stop.longitude !== null) points.push({ id: stop.id, label: stop.bookingName, latitude: stop.latitude, longitude: stop.longitude });
  }
  if (trip.endLatitude !== null && trip.endLongitude !== null) points.push({ id: `${trip.id}:end`, label: trip.endLabel, latitude: trip.endLatitude, longitude: trip.endLongitude });
  return { id: trip.id, name: trip.name, points };
}

export function ManagerScopedMap({ data, variant, focusedBookingId = null, onFocusBooking, mode = "on-road", readOnlyPreview = false }: {
  data: ManagerScopedMapData;
  variant: ManagerMapVariant;
  focusedBookingId?: string | null;
  onFocusBooking?: (bookingId: string) => void;
  mode?: ManagerMapMode;
  onModeChange?: (mode: ManagerMapMode) => void;
  readOnlyPreview?: boolean;
}) {
  const viewport = useMemo(() => viewportFor(data, variant), [data, variant]);
  const focusedTrip = useMemo(() => tripData(data), [data]);
  const label = readOnlyPreview ? "Manager preview map" : variant === "events" ? "Manager events map" : "Manager operations map";

  return (
    <section className="relative z-0 isolate grid gap-3" aria-label={label}>
      {variant === "operations" ? <ManagerTripNavigationActions trip={focusedTrip} mode={mode} /> : null}
      <div className={variant === "events" ? "max-h-[24rem] overflow-hidden rounded-xl border border-slate-200" : "overflow-hidden rounded-xl border border-slate-200"}>
        <ManagerRouteMapShell viewport={viewport}>
          <ManagerScopedMapLayers data={data} focusedBookingId={focusedBookingId} mode={mode} showRoute={Boolean(data.route)} onFocusBooking={onFocusBooking} />
        </ManagerRouteMapShell>
      </div>
    </section>
  );
}
