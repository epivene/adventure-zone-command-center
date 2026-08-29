import { describe, expect, it, vi } from "vitest";

import {
  MANAGER_MAP_MODE_KEY,
  UTAH_DEFAULT_VIEW,
  eventDirectionsDestination,
  googleDirectionsUrl,
  managerEventDirectionsDestination,
  readManagerMapMode,
  writeManagerMapMode,
} from "./manager-map-navigation";

describe("manager map navigation helpers", () => {
  it("restores only valid manager map modes", () => {
    const storage = (value: string | null) => ({ getItem: vi.fn(() => value) });
    expect(readManagerMapMode(storage("on-road"))).toBe("on-road");
    expect(readManagerMapMode(storage("planning"))).toBe("planning");
    expect(readManagerMapMode(storage("garbage"))).toBe("planning");
    expect(readManagerMapMode(storage(null))).toBe("planning");
  });

  it("persists the mode under the versioned key", () => {
    const setItem = vi.fn();
    writeManagerMapMode({ setItem }, "on-road");
    expect(setItem).toHaveBeenCalledWith(MANAGER_MAP_MODE_KEY, "on-road");
  });

  it("builds free Google Maps directions URLs from stored lng/lat coordinates", () => {
    const url = googleDirectionsUrl({ destination: [-105.8406, 46.4083] });
    expect(url).toContain("https://www.google.com/maps/dir/?api=1");
    expect(url).toContain("destination=46.4083%2C-105.8406");
    expect(url).not.toContain("key=");
  });

  it("prefers event coordinates and falls back to a readable city and region", () => {
    expect(eventDirectionsDestination({
      city: "Miles City",
      region: "MT",
      latitude: 46.4083,
      longitude: -105.8406,
    })).toEqual([-105.8406, 46.4083]);
    expect(eventDirectionsDestination({
      city: "Miles City",
      region: "MT",
      latitude: null,
      longitude: null,
    })).toBe("Miles City, MT");
  });

  it("returns no destination when an event has neither coordinates nor a place", () => {
    expect(managerEventDirectionsDestination({
      latitude: null,
      longitude: null,
      city: null,
      region: null,
    })).toBeNull();
  });

  it("supports ordered waypoints without adding a paid API key", () => {
    const url = googleDirectionsUrl({
      destination: [-111.891, 40.7608],
      waypoints: [[-105.8406, 46.4083], "Billings, MT"],
    });
    expect(url).toContain("waypoints=46.4083%2C-105.8406%7CBillings%2C+MT");
    expect(url).not.toContain("key=");
  });

  it("uses a regional Utah fallback rather than a world view", () => {
    expect(UTAH_DEFAULT_VIEW.center[0]).toBeLessThan(-109);
    expect(UTAH_DEFAULT_VIEW.center[0]).toBeGreaterThan(-114.5);
    expect(UTAH_DEFAULT_VIEW.center[1]).toBeGreaterThan(37);
    expect(UTAH_DEFAULT_VIEW.center[1]).toBeLessThan(42.5);
    expect(UTAH_DEFAULT_VIEW.zoom).toBeGreaterThan(4);
  });
});
