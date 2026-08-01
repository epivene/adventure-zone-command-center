import { describe, expect, it } from "vitest";

import {
  effectiveSegmentEstimate,
  fuelEstimate,
  haversineMiles,
  suggestStopOrder,
  tripTotals,
} from "./trip-math";

const denver = { latitude: 39.7392, longitude: -104.9903 };
const colorado_springs = { latitude: 38.8339, longitude: -104.8214 };
const fort_collins = { latitude: 40.5853, longitude: -105.0844 };
const pueblo = { latitude: 38.2544, longitude: -104.6091 };

describe("haversineMiles", () => {
  it("is roughly correct for known city pairs", () => {
    const miles = haversineMiles(denver, colorado_springs);
    expect(miles).toBeGreaterThan(55);
    expect(miles).toBeLessThan(75);
  });

  it("is zero for identical points", () => {
    expect(haversineMiles(denver, denver)).toBe(0);
  });
});

describe("suggestStopOrder", () => {
  it("orders by event date first, then nearest neighbor within a date", () => {
    const day1 = new Date("2026-08-10T12:00:00Z");
    const day2 = new Date("2026-08-11T12:00:00Z");
    const order = suggestStopOrder(
      [
        { id: "far-day1", name: "Pueblo Fair", startsAt: day1, coordinates: pueblo },
        { id: "later", name: "Pueblo", startsAt: day2, coordinates: pueblo },
        { id: "near-day1", name: "Springs", startsAt: day1, coordinates: colorado_springs },
      ],
      denver,
    );
    // Both day1 stops before the day2 stop; nearest (Springs) first from Denver.
    expect(order).toEqual(["near-day1", "far-day1", "later"]);
  });

  it("places undated stops last and coordless stops at their group end", () => {
    const day1 = new Date("2026-08-10T12:00:00Z");
    const order = suggestStopOrder(
      [
        { id: "undated", name: "Aurora", startsAt: null, coordinates: pueblo },
        { id: "no-coords", name: "Boulder", startsAt: day1, coordinates: null },
        { id: "dated", name: "Springs", startsAt: day1, coordinates: colorado_springs },
      ],
      denver,
    );
    expect(order).toEqual(["dated", "no-coords", "undated"]);
  });

  it("is deterministic with no start point", () => {
    const order = suggestStopOrder(
      [
        { id: "b", name: "B", startsAt: null, coordinates: pueblo },
        { id: "a", name: "A", startsAt: null, coordinates: fort_collins },
      ],
      null,
    );
    expect(order).toEqual(["a", "b"]);
  });
});

describe("effectiveSegmentEstimate", () => {
  it("labels overrides as manual and prefers them", () => {
    expect(
      effectiveSegmentEstimate({
        miles: 100,
        minutes: 120,
        source: "live",
        overrideMiles: 90,
        overrideMinutes: null,
      }),
    ).toEqual({ miles: 90, minutes: 120, source: "manual" });
  });

  it("passes through live/cached labels", () => {
    expect(
      effectiveSegmentEstimate({
        miles: 100,
        minutes: 120,
        source: "cached",
        overrideMiles: null,
        overrideMinutes: null,
      }),
    ).toEqual({ miles: 100, minutes: 120, source: "cached" });
  });

  it("returns null source when no estimate exists", () => {
    expect(
      effectiveSegmentEstimate({
        miles: null,
        minutes: null,
        source: null,
        overrideMiles: null,
        overrideMinutes: null,
      }),
    ).toEqual({ miles: null, minutes: null, source: null });
  });
});

describe("fuel math", () => {
  it("computes gallons and cost as miles / mpg * price", () => {
    expect(fuelEstimate(300, 10, 3.5)).toEqual({ gallons: 30, cost: 105 });
  });

  it("returns null without mpg and null cost without a price", () => {
    expect(fuelEstimate(300, null, 3.5)).toBeNull();
    expect(fuelEstimate(300, 10, null)).toEqual({ gallons: 30, cost: null });
  });

  it("totals segments using overrides and flags missing estimates", () => {
    const totals = tripTotals(
      [
        { miles: 100, minutes: 120, source: "live", overrideMiles: null, overrideMinutes: null },
        { miles: 50, minutes: 60, source: "cached", overrideMiles: 150, overrideMinutes: 90 },
        { miles: null, minutes: null, source: null, overrideMiles: null, overrideMinutes: null },
      ],
      25,
      4,
    );
    expect(totals.miles).toBe(250);
    expect(totals.minutes).toBe(210);
    expect(totals.gallons).toBe(10);
    expect(totals.cost).toBe(40);
    expect(totals.incomplete).toBe(true);
  });
});
