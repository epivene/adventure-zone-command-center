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

type RenderEvent = MapEvent & { planningEmphasis?: "primary" | "dimmed" };

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function eventIcon(event: RenderEvent, focused: boolean) {
  const color = event.travelLegColor || "#64748b";
  const classes = ["az-route-pin", focused ? "az-route-pin--focused" : "", event.planningEmphasis === "dimmed" ? "az-route-pin--dimmed" : ""]
    .filter(Boolean)
    .join(" ");
  return L.divIcon({
    className: "az-route-marker-wrap",
    html: `<span class="${classes}" style="--az-pin-color:${escapeHtml(color)}"><span class="az-route-pin__dot"></span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -34],
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

export function ManagerRouteMapLayers({
  events,
  handoffs,
  focusedEventId,
  managerMode,
  focusedTrip,
  onFocusEvent,
}: {
  events: RenderEvent[];
  handoffs: EquipmentHandoffView[];
  focusedEventId: string | null;
  managerMode: ManagerMapMode;
  focusedTrip?: FocusedTripMapData | null;
  onFocusEvent?: (id: string) => void;
}) {
  const map = useManagerRouteMap();

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup().addTo(map);

    if (focusedTrip && focusedTrip.points.length > 1) {
      L.polyline(
        focusedTrip.points.map((point) => [point.latitude, point.longitude] as [number, number]),
        { weight: 5, opacity: 0.8 },
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
  }, [events, focusedEventId, focusedTrip, handoffs, managerMode, map, onFocusEvent]);

  return null;
}
