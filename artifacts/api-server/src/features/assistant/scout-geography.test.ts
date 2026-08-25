import { describe, expect, it, vi } from "vitest";

import { distanceMiles, ScoutAreaResolver, ScoutGeocoder, withinRadius } from "./scout-geography";

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

  it("enumerates named communities inside the selected circle and drops outside points", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ elements: [
      { lat: 46.4083, lon: -105.8406, tags: { name: "Miles City", place: "city" } },
      { lat: 45.7833, lon: -108.5007, tags: { name: "Billings", place: "city" } },
      { lat: 42.5629, lon: -114.4609, tags: { name: "Twin Falls", place: "city" } },
      { lat: 45.7834, lon: -108.5008, tags: { name: "Billings", place: "town" } },
    ] }), { status: 200, headers: { "content-type": "application/json" } }));

    const places = await new ScoutAreaResolver(fetchFn as typeof fetch).listPlaces(milesCity, 200);

    expect(places.map((place) => place.name)).toEqual(["Miles City", "Billings"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("keeps counties whose administrative boundary intersects the circle", async () => {
    const fetchFn = vi.fn(async (_url, init) => {
      const encoded = String(init?.body ?? "");
      expect(encoded).toContain("admin_level%22%3D%226%22");
      return new Response(JSON.stringify({ elements: [
        { lat: 46.4083, lon: -105.8406, tags: { name: "Miles City", place: "city" } },
        {
          center: { lat: 43.0, lon: -108.0 },
          tags: { name: "Custer County", boundary: "administrative", admin_level: "6" },
        },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const places = await new ScoutAreaResolver(fetchFn as typeof fetch).listPlaces(milesCity, 200);

    expect(places).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Miles City", placeType: "city" }),
      expect.objectContaining({ name: "Custer County", placeType: "county" }),
    ]));
  });
});