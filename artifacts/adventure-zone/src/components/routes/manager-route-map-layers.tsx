"use client";

import { useEffect } from "react";
import L from "leaflet";

import type { EquipmentHandoffView } from "@/components/routes/equipment-handoffs";
import type { MapEvent } from "@/features/routes/map-data";
import { googleDirectionsUrl, type ManagerMapMode } from "@/features/routes/manager-map-navigation";
import { useManagerRouteMap } from "./manager-route-map-shell";

export type FocusedTripMapData = {
  id: string;
  name: string;
  points: Array<{ id: string; label: string; latitude: number; longitude: number }>;
};

export type PlanningRouteLine = {
  coordinates: [number, number][];
  color: string;
  emphasis: "primary" | "dimmed";
};

type RenderEvent = MapEvent & {
  planningEmphasis?: "primary" | "dimmed";
  routeStopNumber?: number | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;" })[char]!);
}

function eventIcon(event: RenderEvent, focused: boolean) {
  const color = event.travelLegColor || "#64748b";
  const isContext = event.routeBucket !== "confirmed" || event.routeStopNumber == null;
  const isDimmed = isContext || event.planningEmphasis === "dimmed";
  const classes = [
    "az-route-pin",
    isContext ? "az-route-pin--context" : "",
    focused ? "az-route-pin--focused" : "",
    event.planningEmphasis === "dimmed" ? "az-route-pin--dimmed" : "",
  ].filter(Boolean).join(" ");
  const contents = isContext
    ? '<span class="az-route-pin__dot"></span>'
    : `<span class="az-route-pin__stop-number">${event.routeStopNumber}</span>`;
  return L.divIcon({
    className: "az-route-marker-wrap",
    html: `<span class="${classes}" style="--az-pin-color:${escapeHtml(color)};opacity:${isDimmed ? "0.62" : "1"}">${contents}</span>`,
    iconSize: isContext ? [20, 24] : [30, 38],
    iconAnchor: isContext ? [10, 22] : [15, 36],
    popupAnchor: isContext ? [0, -20] : [0, -34],
  });
}

function handoffIcon(handoff: EquipmentHandoffView) {
  const approved = handoff.status === "approved";
  return L.divIcon({
    className: "az-handoff-marker-wrap",
    html: `<span class="az-handoff-marker ${approved ? "az-handoff-marker--approved" : "az-handoff-marker--suggested"}">↔</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function warningText(event: RenderEvent) {
  if (event.legAssignmentWarning === "major_travel_concern") return "Major travel concern";
  if (event.legAssignmentWarning === "long_travel") return "Long travel";
  return null;
}

function eventPopup(event: RenderEvent, managerMode: ManagerMapMode, showBookingDetailsLink: boolean) {
  const destination = event.latitude !== null && event.longitude !== null
    ? ([event.longitude, event.latitude] as [number, number])
    : [event.city, event.region].filter(Boolean).join(", ");
  const directions = googleDirectionsUrl({ destination });
  const dates = event.startsAt
    ? `${event.startsAt.toLocaleDateString()}${event.endsAt ? ` – ${event.endsAt.toLocaleDateString()}` : ""}`
    : "Date not set";
  const assignmentLabel = event.travelLegAssignmentKind === "suggested" ? "Suggested leg" : "Leg";
  const warning = warningText(event);
  return `<div class="az-route-popup">
    <strong>${escapeHtml(event.name)}</strong>
    <div>${escapeHtml([event.city, event.region].filter(Boolean).join(", "))}</div>
    <div>${escapeHtml(dates)}</div>
    <div>${event.routeStopNumber ? `Stop ${event.routeStopNumber} · ` : ""}${escapeHtml(assignmentLabel)}: ${escapeHtml(event.travelLegName || "No leg")} · ${escapeHtml(event.status)}</div>
    ${warning ? `<div><strong>${escapeHtml(warning)}</strong></div>` : ""}
    ${event.legAssignmentExplanation ? `<div>${escapeHtml(event.legAssignmentExplanation)}</div>` : ""}
    <div class="az-route-popup__actions">
      ${showBookingDetailsLink ? `<a href="/bookings/${encodeURIComponent(event.id)}">Booking details</a>` : ""}
      <a href="${escapeHtml(directions)}" target="_blank" rel="noreferrer">${managerMode === "on-road" ? "Directions" : "Directions to event"}</a>
    </div>
  </div>`;
}

export function ManagerTripNavigationActions({
  trip,
  mode,
}: {
  trip: FocusedTripMapData | null;
  mode: ManagerMapMode;
}) {
  if (!trip?.points.length) return null;
  const firstDestination = trip.points.length > 1 ? trip.points[1]! : trip.points[0]!;
  const finalDestination = trip.points[trip.points.length - 1]!;
  const fullRouteWaypoints = trip.points.slice(0, -1).map(
    (point) => [point.longitude, point.latitude] as [number, number],
  );
  const nextUrl = googleDirectionsUrl({ destination: [firstDestination.longitude, firstDestination.latitude] });
  const fullRouteUrl = googleDirectionsUrl({
    destination: [finalDestination.longitude, finalDestination.latitude],
    waypoints: fullRouteWaypoints,
  });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="mr-auto">
        <p className="text-sm font-bold text-slate-900">{trip.name}</p>
        <p className="text-xs text-slate-500">{trip.points.length} mapped route points</p>
      </div>
      {mode === "on-road" ? (
        <a className="button-primary" href={nextUrl} rel="noreferrer" target="_blank">Navigate to next stop</a>
      ) : null}
      <a className="button-secondary" href={fullRouteUrl} rel="noreferrer" target="_blank">Open full trip route</a>
    </div>
  );
}

export function ManagerRouteMapLayers({
  events,
  handoffs,
  routeLines = [],
  focusedEventId,
  managerMode,
  focusedTrip,
  onFocusEvent,
  showBookingDetailsLink = true,
}: {
  events: RenderEvent[];
  handoffs: EquipmentHandoffView[];
  routeLines?: PlanningRouteLine[];
  focusedEventId: string | null;
  managerMode: ManagerMapMode;
  focusedTrip?: FocusedTripMapData | null;
  onFocusEvent?: (id: string) => void;
  showBookingDetailsLink?: boolean;
}) {
  const map = useManagerRouteMap();

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup().addTo(map);

    for (const routeLine of routeLines) {
      L.polyline(
        routeLine.coordinates.map(([longitude, latitude]) => [latitude, longitude] as [number, number]),
        {
          color: routeLine.color,
          weight: routeLine.emphasis === "dimmed" ? 2 : 4,
          opacity: routeLine.emphasis === "dimmed" ? 0.2 : 0.7,
        },
      ).addTo(group);
    }

    if (focusedTrip && focusedTrip.points.length > 1) {
      L.polyline(
        focusedTrip.points.map((point) => [point.latitude, point.longitude] as [number, number]),
        { color: "#0f172a", weight: 5, opacity: 0.85 },
      ).addTo(group);
      focusedTrip.points.forEach((point, index) => {
        const icon = L.divIcon({
          className: "az-trip-stop-wrap",
          html: `<span class="az-trip-stop">${index + 1}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([point.latitude, point.longitude], { icon, keyboard: true, title: point.label }).addTo(group);
      });
    }

    for (const event of events) {
      if (event.latitude === null || event.longitude === null) continue;
      const marker = L.marker([event.latitude, event.longitude], {
        icon: eventIcon(event, focusedEventId === event.id),
        keyboard: true,
        title: event.name,
      }).addTo(group);
      marker.bindPopup(eventPopup(event, managerMode, showBookingDetailsLink));
      marker.on("click", () => onFocusEvent?.(event.id));
    }

    for (const handoff of handoffs) {
      if (handoff.status === "dismissed") continue;
      L.marker([handoff.meetupLatitude, handoff.meetupLongitude], {
        icon: handoffIcon(handoff),
        keyboard: true,
        title: handoff.meetupLabel,
      }).addTo(group).bindPopup(`<strong>${escapeHtml(handoff.meetupLabel)}</strong><div>${escapeHtml(handoff.status)}</div>`);
    }

    return () => {
      group.remove();
    };
  }, [events, focusedEventId, focusedTrip, handoffs, managerMode, map, onFocusEvent, routeLines, showBookingDetailsLink]);

  return null;
}
