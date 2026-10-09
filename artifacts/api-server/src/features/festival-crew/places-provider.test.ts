import { describe, it, expect, vi } from "vitest";
import { parseOverpass, distanceMiles, safePublicUrl, validCoordinates, PhotonGeocodingProvider, OverpassPlacesProvider } from "./places-provider";

const point = (id: number, tags: Record<string, string>, type = "node") => ({ id, type, lat: 43.7, lon: -116.35, tags });
describe("community places are suggestions, not parking confirmations", () => {
  it("prioritizes RV parks and classifies all eight categories", () => {
    const input = { elements: [
      point(1, { amenity: "fuel" }), point(2, { tourism: "caravan_site", power_supply: "yes" }),
      point(3, { name: "Walmart", shop: "supermarket" }), point(4, { shop: "car_repair" }),
      point(5, { shop: "tyres" }), point(6, { shop: "car_repair", name: "Jiffy Lube" }),
      point(7, { shop: "hardware" }), point(8, { amenity: "toilets" }),
    ] };
    const result = parseOverpass(input, 43.7, -116.35, 10);
    expect(result[0].category).toBe("rv_park");
    expect(new Set(result.map(x => x.category)).size).toBe(8);
    expect(result.find(x => x.category === "walmart")).not.toHaveProperty("overnight");
    expect(result[0]).not.toHaveProperty("hookups");
  });
  it("deduplicates elements, rejects invalid locations and excludes tent-only sites", () => {
    const tent = point(2, { tourism: "camp_site", caravans: "no" });
    const fuel = point(1, { amenity: "fuel", website: "javascript:alert(1)" });
    const result = parseOverpass({ elements: [fuel, fuel, tent, { ...fuel, id: 3, lat: 91 }, { ...fuel, id: 4, lat: 30 }] }, 43.7, -116.35, 10);
    expect(result).toHaveLength(1);
    expect(result[0].website).toBe("");
    expect(result[0].sourceUrl).toBe("https://www.openstreetmap.org/node/1");
  });
  it("handles way centers and limits each category; never renders provider HTML", () => {
    const elements = Array.from({ length: 30 }, (_, i) => ({ type: "way", id: i + 1, center: { lat: 43.7, lon: -116.35 }, tags: { tourism: "caravan_site", name: "<script>not HTML</script>" } }));
    expect(parseOverpass({ elements }, 43.7, -116.35, 10)).toHaveLength(20);
    expect(() => parseOverpass({ elements, remark: "timeout: partial result" }, 43.7, -116.35, 10)).toThrow("temporarily unavailable");
  });
  it("validates coordinate and URL boundaries and labels straight-line distances", () => {
    expect(validCoordinates(0, 0)).toBe(true);
    expect(validCoordinates(NaN, 0)).toBe(false);
    expect(safePublicUrl("file:///etc/passwd")).toBe("");
    expect(distanceMiles(0, 0, 1, 0)).toBeCloseTo(69.1, 1);
  });
  it("caches and single-flights explicit venue searches", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ geometry: { coordinates: [-116.35, 43.7] }, properties: { name: "Test venue", city: "Eagle" } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const provider = new PhotonGeocodingProvider();
      const a = provider.geocode("unique test cache address"), b = provider.geocode("unique test cache address");
      await vi.advanceTimersByTimeAsync(1101);
      expect(await a).toEqual(await b);
      await provider.geocode("unique test cache address");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("photon.komoot.io");
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
  it("uses an encoded GET query and accepts real OSM result shapes", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [{ type: "node", id: 8672380702, lat: 43.5831, lon: -116.2796, tags: { name: "RV park", tourism: "caravan_site" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = new OverpassPlacesProvider().search(43.6953, -116.3522, 25);
      await vi.advanceTimersByTimeAsync(1101);
      expect((await result).suggestions[0].category).toBe("rv_park");
      const [url, options] = fetchMock.mock.calls[0];
      expect(new URL(String(url)).hostname).toBe("overpass.private.coffee");
      expect(new URL(String(url)).searchParams.get("data")).toContain("out center tags 2000;");
      expect(options.method).toBe("GET");
      expect(options.body).toBeUndefined();
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
  it("failure backoff avoids repeated provider calls and does not fabricate places", async () => {
    vi.useFakeTimers(); const fetchMock = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal("fetch", fetchMock);
    try {
      const provider = new OverpassPlacesProvider();
      const result = provider.search(43.7001, -116.3501, 25);
      const assertion = expect(result).rejects.toThrow("temporarily unavailable");
      await vi.advanceTimersByTimeAsync(1101); await assertion;
      await expect(provider.search(43.7001, -116.3501, 25)).rejects.toThrow("temporarily unavailable");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  });
});
