import { describe, expect, it, vi } from "vitest";

import { distanceMiles, ScoutGeocoder, withinRadius } from "./scout-geography";

const milesCity = { latitude: 46.4083, longitude: -105.8406 };
const billings = { latitude: 45.7833, longitude: -108.5007 };
const twinFalls = { latitude: 42.5629, longitude: -114.4609 };

describe("Scout geography", () => {
  it("computes useful straight-line distances", () => {
    expect(distanceMiles(milesCity, billings)).toBeGreaterThan(130);
    expect(distanceMiles(milesCity, billings)).toBeLessThan(160);
  });

  it("enforces the selected radius", () => {
    expect(withinRadius(milesCity, billings, 200)).toBe(true);
    expect(withinRadius(milesCity, twinFalls, 200)).toBe(false);
  });

  it("resolves a public US place through the injected geocoder transport", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([{
      lat: "46.4083",
      lon: "-105.8406",
      display_name: "Miles City, Custer County, Montana, United States",
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    const geocoder = new ScoutGeocoder(fetchFn as typeof fetch);

    const result = await geocoder.resolve("Miles City, MT");

    expect(result).toMatchObject({ latitude: 46.4083, longitude: -105.8406 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns null when a place cannot be resolved", async () => {
    const fetchFn = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(new ScoutGeocoder(fetchFn as typeof fetch).resolve("Not a real place")).resolves.toBeNull();
  });
});