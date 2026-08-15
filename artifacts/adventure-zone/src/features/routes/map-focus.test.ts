import { describe, expect, it } from "vitest";

import type { MapEvent } from "./map-data";
import { UTAH_DEFAULT_VIEW } from "./manager-map-navigation";
import { primaryViewportEvents, routeScopeSummary, viewportTarget } from "./map-focus";

const baseEvent = (overrides: Partial<MapEvent>): MapEvent => ({
  id: "event-1",
  name: "Event",
  city: "Miles City",
  region: "MT",
  latitude: 46.4083,
  longitude: -105.8406,
  status: "confirmed",
  probability: "possible",
  travelLegId: "leg-kristy",
  travelLegName: "Kristy",
  travelLegColor: "#f97316",
  startsAt: new Date("2026-08-18T12:00:00Z"),
  endsAt: new Date("2026-08-21T12:00:00Z"),
  routeBucket: "confirmed",
  locationQuality: "city",
  locationLabel: "Miles City, MT",
  mappingState: "mapped_city",
  seasonYear: 2026,
  ...overrides,
});

describe("primaryViewportEvents", () => {
  it("keeps the focused leg primary while other legs stay context", () => {
    const kristy = baseEvent({ id: "kristy", travelLegId: "leg-kristy" });
    const hulk = baseEvent({ id: "hulk", travelLegId: "leg-hulk", travelLegName: "Hulk", longitude: -108.5, latitude: 45.78 });
    expect(primaryViewportEvents([kristy, hulk], "full", "leg-kristy").map((event) => event.id)).toEqual(["kristy"]);
  });

  it("uses only confirmed primary events in confirmed mode", () => {
    const confirmed = baseEvent({ id: "confirmed", status: "confirmed", routeBucket: "confirmed" });
    const potential = baseEvent({ id: "potential", status: "possible", routeBucket: "potential", longitude: -108.5, latitude: 45.78 });
    expect(primaryViewportEvents([confirmed, potential], "confirmed", null).map((event) => event.id)).toEqual(["confirmed"]);
  });

  it("uses only potential primary events in potential mode", () => {
    const confirmed = baseEvent({ id: "confirmed", status: "confirmed", routeBucket: "confirmed" });
    const potential = baseEvent({ id: "potential", status: "possible", routeBucket: "potential", longitude: -108.5, latitude: 45.78 });
    expect(primaryViewportEvents([confirmed, potential], "potential", null).map((event) => event.id)).toEqual(["potential"]);
  });

  it("uses historical events in history mode", () => {
    const history = baseEvent({ id: "history", status: "completed", routeBucket: "history" });
    const active = baseEvent({ id: "active", status: "confirmed", routeBucket: "confirmed" });
    expect(primaryViewportEvents([history, active], "history", null).map((event) => event.id)).toEqual(["history"]);
  });
});

describe("viewportTarget", () => {
  it("centers one Miles City event at useful city zoom", () => {
    const event = baseEvent({ id: "miles-city" });
    expect(viewportTarget({ primaryEvents: [event], explicitEventId: null, tripCoordinates: null })).toEqual({
      kind: "center",
      center: [-105.8406, 46.4083],
      zoom: 10,
    });
  });

  it("returns bounds for multiple primary events", () => {
    const a = baseEvent({ id: "a" });
    const b = baseEvent({ id: "b", longitude: -108.5007, latitude: 45.7833 });
    expect(viewportTarget({ primaryEvents: [a, b], explicitEventId: null, tripCoordinates: null })).toEqual({
      kind: "bounds",
      coordinates: [[-105.8406, 46.4083], [-108.5007, 45.7833]],
    });
  });

  it("returns the Utah regional fallback when no mapped primary events remain", () => {
    expect(viewportTarget({ primaryEvents: [], explicitEventId: null, tripCoordinates: null })).toEqual({
      kind: "center",
      center: UTAH_DEFAULT_VIEW.center,
      zoom: UTAH_DEFAULT_VIEW.zoom,
    });
  });

  it("prioritizes explicit event focus over trip focus", () => {
    const miles = baseEvent({ id: "miles" });
    const billings = baseEvent({ id: "billings", longitude: -108.5007, latitude: 45.7833 });
    expect(viewportTarget({
      primaryEvents: [miles, billings],
      explicitEventId: "miles",
      tripCoordinates: [[-108.5007, 45.7833], [-104.8202, 41.14]],
    })).toEqual({ kind: "center", center: [-105.8406, 46.4083], zoom: 11 });
  });
});

describe("routeScopeSummary", () => {
  it("shows only active scope dimensions", () => {
    expect(routeScopeSummary({
      mode: "confirmed",
      seasonYear: 2026,
      focusedLegName: "Kristy",
      region: "MT",
      dateFrom: null,
      dateTo: null,
    })).toBe("Showing Kristy · Confirmed · 2026 · MT");
  });
});
