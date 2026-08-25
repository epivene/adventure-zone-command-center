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

type RenderEvent = MapEvent & { planningEmphasis?: "primary" | "dimmed" };

function escapeHtml(value: string) {
  return value.replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;" })[char]!);
}

function eventIcon(event: RenderEvent, focused: boolean) {
  const color = event.travelLegColor || "#64748b";
  const isPotential = event.status !== "confirmed";
  const isDimmed = isPotential || event.planningEmphasis === "dimmed";
  const classes = ["az-route-pin", focused ? "az-route-pin--focused" : "", event.planningEmphasis === "dimmed" ? "az-route-pin--dimmed" : ""]
    .filter(Boolean)
    .join(" ");
  return L.divIcon({
    className: "az-route-marker-wrap",
    html: `<span class="${classes}" style="--az-pin-color:${escapeHtml(color)};width:22px;height:22px;opacity:${isDimmed ? "0.62" : "1"}"><span class="az-route-pin__dot"></span></span>`,
    iconSize: [26, 32],
    iconAnchor: [13, 30],
    popupAnchor: [0, -28],
  });
}

function handoffIcon(handoff: EquipmentHandoffView) {
  const approved = handoff.status === "approved";
  return L.divIcon({
    className: "az-handoff-marker-wrap",
    html: `<span class="az-handoff-marker ${approved ? "az-handoff-marker--approved" : "az-handoff-marker--suggested"}">↔</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function eventPopup(event: RenderEvent, managerMode: ManagerMapMode) {
  const destination = event.latitude !== null && event.longitude !== null
    ? ([event.longitude, event.latitude] as [number, number])
    : [event.city, event.region].filter(Boolean).join(", ");
  const directions = googleDirectionsUrl({ destination });
  const dates = event.startsAt
    ? `${event.startsAt.toLocaleDateString()}${event.endsAt ? ` – ${event.endsAt.toLocaleDateString()}` : ""}`
    : "Date not set";
  return `<div class="az-route-popup">
    <strong>${escapeHtml(event.name)}</strong>
    <div>${escapeHtml([event.city, event.region].filter(Boolean).join(", "))}</div>
    <div>${escapeHtml(dates)}</div>
    <div>${escapeHtml(event.travelLegName || "No leg")} · ${escapeHtml(event.status)}</div>
    <div class="az-route-popup__actions">
      <a href="/bookings/${encodeURIComponent(event.id)}">Booking details</a>
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
}: {
  events: RenderEvent[];
  handoffs: EquipmentHandoffView[];
  routeLines?: PlanningRouteLine[];
  focusedEventId: string | null;
  managerMode: ManagerMapMode;
  focusedTrip?: FocusedTripMapData | null;
  onFocusEvent?: (id: string) => void;
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
      marker.bindPopup(eventPopup(event, managerMode));
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
  }, [events, focusedEventId, focusedTrip, handoffs, managerMode, map, onFocusEvent, routeLines]);

  return null;
}
