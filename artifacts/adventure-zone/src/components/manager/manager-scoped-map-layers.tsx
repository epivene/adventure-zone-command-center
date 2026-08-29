"use client";

import { useEffect } from "react";
import L from "leaflet";
import { useManagerRouteMap } from "@/components/routes/manager-route-map-shell";
import { eventDirectionsDestination, googleDirectionsUrl, type ManagerMapMode } from "@/features/routes/manager-map-navigation";
import type { ManagerScopedMapData } from "@/features/manager/manager-map-types";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function pinIcon(color: string, focused: boolean) {
  return L.divIcon({
    className: "az-route-marker-wrap",
    html: `<span class="az-route-pin ${focused ? "az-route-pin--focused" : ""}" style="--az-pin-color:${escapeHtml(color)}"><span class="az-route-pin__dot"></span></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -34],
  });
}

function meetupIcon() {
  return L.divIcon({
    className: "az-handoff-marker-wrap",
    html: `<span class="az-handoff-marker az-handoff-marker--approved">↔</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function meetupName(counterpart: ManagerScopedMapData["meetups"][number]["counterpart"]) {
  return counterpart.kind === "leg" ? counterpart.legName : counterpart.displayName;
}

export function ManagerScopedMapLayers({ data, focusedBookingId, mode, showRoute, onFocusBooking }: {
  data: ManagerScopedMapData;
  focusedBookingId: string | null;
  mode: ManagerMapMode;
  showRoute: boolean;
  onFocusBooking?: (bookingId: string) => void;
}) {
  const map = useManagerRouteMap();

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup().addTo(map);
    const color = data.leg.color || "#f97316";

    if (showRoute && data.route) {
      const points: Array<[number, number]> = [];
      if (data.route.trip.startLatitude !== null && data.route.trip.startLongitude !== null) points.push([data.route.trip.startLatitude, data.route.trip.startLongitude]);
      for (const stop of [...data.route.stops].sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (stop.latitude !== null && stop.longitude !== null) points.push([stop.latitude, stop.longitude]);
      }
      if (data.route.trip.endLatitude !== null && data.route.trip.endLongitude !== null) points.push([data.route.trip.endLatitude, data.route.trip.endLongitude]);
      if (points.length > 1) L.polyline(points, { color, weight: 5, opacity: 0.8 }).addTo(group);
      points.forEach((point, index) => {
        const icon = L.divIcon({ className: "az-trip-stop-wrap", html: `<span class="az-trip-stop">${index + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
        L.marker(point, { icon }).addTo(group);
      });
    }

    for (const event of data.events) {
      if (event.latitude === null || event.longitude === null) continue;
      const marker = L.marker([event.latitude, event.longitude], {
        icon: pinIcon(color, focusedBookingId === event.bookingId),
        keyboard: true,
        title: event.bookingName,
      }).addTo(group);
      const directions = googleDirectionsUrl({ destination: eventDirectionsDestination(event) });
      marker.bindPopup(`<div class="az-route-popup"><strong>${escapeHtml(event.bookingName)}</strong><div>${escapeHtml([event.city, event.region].filter(Boolean).join(", "))}</div><div>${event.startsAt ? escapeHtml(event.startsAt.toLocaleString()) : "Date not set"}</div><div class="az-route-popup__actions"><a href="${escapeHtml(directions)}" target="_blank" rel="noreferrer">${mode === "on-road" ? "Directions" : "Directions to event"}</a></div></div>`);
      marker.on("click", () => onFocusBooking?.(event.bookingId));
    }

    for (const meetup of data.meetups) {
      const name = meetupName(meetup.counterpart);
      const directions = googleDirectionsUrl({ destination: [meetup.meetupLongitude, meetup.meetupLatitude] });
      const contact = meetup.counterpart.kind === "external_contact"
        ? [meetup.counterpart.phone, meetup.counterpart.email].filter(Boolean).map((value) => `<div>${escapeHtml(value!)}</div>`).join("")
        : "";
      L.marker([meetup.meetupLatitude, meetup.meetupLongitude], { icon: meetupIcon(), keyboard: true, title: `Meet ${name}` })
        .addTo(group)
        .bindPopup(`<div class="az-route-popup"><strong>Meet ${escapeHtml(name)}${meetup.resourceName ? ` — ${escapeHtml(meetup.resourceName)}` : ""}</strong><div>${escapeHtml(meetup.meetupLabel)}</div><div>${escapeHtml(meetup.windowStartsAt.toLocaleString())}</div>${contact}<div class="az-route-popup__actions"><a href="${escapeHtml(directions)}" target="_blank" rel="noreferrer">Directions to meetup</a></div></div>`);
    }

    return () => { group.remove(); };
  }, [data, focusedBookingId, map, mode, onFocusBooking, showRoute]);

  return null;
}
