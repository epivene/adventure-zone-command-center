import type { GeocodeResult, GeocodingProvider } from "../trips/geocoding";

export type StopCategory = "rv_park" | "walmart" | "mechanic" | "tires" | "oil_change" | "hardware" | "bathroom" | "fuel";
export type Suggestion = { sourceKey: string; name: string; category: StopCategory; address: string; latitude: number; longitude: number; sourceUrl: string; phone: string; website: string; distanceMiles: number };
const HOUR = 3_600_000;
export class PlaceProviderError extends Error {
  constructor() { super("Place lookup is temporarily unavailable. Try later, or add a crew stop manually."); }
}
export function safePublicUrl(value: string) {
  if (!value) return "";
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.toString() : ""; } catch { return ""; }
}
export function validCoordinates(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
export function distanceMiles(a: number, b: number, c: number, d: number) {
  const rad = (x: number) => x * Math.PI / 180;
  const h = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return Math.round(3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h))) * 10) / 10;
}
function categoryFor(t: Record<string, string>): StopCategory | null {
  if (t.caravans !== "no" && ["caravan_site", "camp_site"].includes(t.tourism)) return "rv_park";
  if (/walmart|wal-mart/i.test(`${t.name ?? ""} ${t.brand ?? ""}`)) return "walmart";
  if (t.shop === "tyres" || t["service:vehicle:tyres"] === "yes") return "tires";
  if (/jiffy lube|valvoline|oil change|take 5/i.test(`${t.name ?? ""} ${t.brand ?? ""}`) || t["service:vehicle:oil_change"] === "yes") return "oil_change";
  if (t.shop === "car_repair") return "mechanic";
  if (["hardware", "doityourself"].includes(t.shop)) return "hardware";
  if (t.amenity === "toilets") return "bathroom";
  if (t.amenity === "fuel") return "fuel";
  return null;
}
export function parseOverpass(body: unknown, lat: number, lng: number, radiusMiles: number): Suggestion[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as any).elements) || (body as any).remark) throw new PlaceProviderError();
  const seen = new Set<string>();
  const rows: Suggestion[] = [];
  for (const e of (body as any).elements.slice(0, 2000)) {
    if (!["node", "way", "relation"].includes(e?.type) || !Number.isSafeInteger(e.id) || e.id <= 0) continue;
    const t: Record<string, string> = Object.fromEntries(Object.entries(e.tags ?? {}).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v).slice(0, 2000)]));
    const category = categoryFor(t), latitude = e.lat ?? e.center?.lat, longitude = e.lon ?? e.center?.lon;
    if (!category || !validCoordinates(latitude, longitude)) continue;
    const miles = distanceMiles(lat, lng, latitude, longitude);
    const sourceKey = `${e.type}/${e.id}`;
    if (miles > radiusMiles || seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    rows.push({
      sourceKey, name: (t.name || t.brand || ({ rv_park: "Mapped campground / RV site", bathroom: "Mapped bathroom", fuel: "Mapped gas station" } as any)[category] || "Mapped crew stop").slice(0, 200),
      category, latitude, longitude, sourceUrl: `https://www.openstreetmap.org/${sourceKey}`,
      address: [t["addr:housenumber"], t["addr:street"], t["addr:city"], t["addr:state"], t["addr:postcode"]].filter(Boolean).join(" ").slice(0, 500),
      phone: (t["contact:phone"] || t.phone || "").slice(0, 80),
      website: safePublicUrl(t["contact:website"] || t.website || ""), distanceMiles: miles,
    });
  }
  rows.sort((a, b) => Number(b.category === "rv_park") - Number(a.category === "rv_park") || a.distanceMiles - b.distanceMiles);
  const counts: Partial<Record<StopCategory, number>> = {};
  return rows.filter(r => (counts[r.category] = (counts[r.category] ?? 0) + 1) <= 20);
}

// Bounded cache, single-flight requests and failure backoff; never a background crawl.
class CachedLookups<T> {
  private cache = new Map<string, { expires: number; value?: T; failed?: boolean }>();
  private inFlight = new Map<string, Promise<T>>();
  private tail: Promise<unknown> = Promise.resolve();
  run(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.failed ? Promise.reject(new PlaceProviderError()) : Promise.resolve(hit.value!);
    const current = this.inFlight.get(key);
    if (current) return current;
    if (this.inFlight.size >= 3) return Promise.reject(new PlaceProviderError());
    const request = this.tail.catch(() => {}).then(async () => {
      // Conservative pacing also applies when changing configured providers.
      await new Promise(resolve => setTimeout(resolve, 1100));
      try {
        const value = await fetcher();
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: Date.now() + 6 * HOUR, value });
        return value;
      } catch {
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: Date.now() + 30_000, failed: true });
        throw new PlaceProviderError();
      }
    }).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, request);
    this.tail = request;
    return request;
  }
}
const addresses = new CachedLookups<GeocodeResult[]>();
const nearby = new CachedLookups<{ suggestions: Suggestion[]; searchedAt: string; radiusMiles: number }>();
export class PhotonGeocodingProvider implements GeocodingProvider {
  async geocode(query: string): Promise<GeocodeResult[]> {
    return addresses.run(query.trim().toLowerCase(), async () => {
      const url = new URL("/api/", process.env.FESTIVAL_PHOTON_BASE_URL ?? "https://photon.komoot.io");
      url.searchParams.set("q", query.trim()); url.searchParams.set("limit", "5"); url.searchParams.set("lang", "en");
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "AdventureZone-FestivalCrew/1.0", Accept: "application/json" } });
      if (!response.ok) throw new PlaceProviderError();
      const data = await response.json();
      if (!Array.isArray(data.features)) throw new PlaceProviderError();
      return data.features.flatMap((f: any) => {
        const [longitude, latitude] = f?.geometry?.coordinates ?? [];
        if (!validCoordinates(latitude, longitude)) return [];
        const p = f.properties ?? {};
        const displayName = [...new Set([p.name, p.housenumber, p.street, p.city, p.state, p.postcode, p.country].filter(x => typeof x === "string" && x))].join(", ").slice(0, 2000);
        return displayName ? [{ latitude, longitude, displayName }] : [];
      });
    });
  }
}
export class OverpassPlacesProvider {
  async search(lat: number, lng: number, radiusMiles: number) {
    if (!validCoordinates(lat, lng) || ![10, 25, 50].includes(radiusMiles)) throw new PlaceProviderError();
    return nearby.run(`${lat}:${lng}:${radiusMiles}`, async () => {
      const around = `(around:${Math.round(radiusMiles * 1609.344)},${lat},${lng})`;
      const selectors = ['["tourism"~"^(caravan_site|camp_site)$"]', '["brand"~"walmart|wal-mart",i]', '["name"~"walmart|wal-mart|jiffy lube|valvoline|oil change|take 5",i]', '["shop"~"^(car_repair|tyres|hardware|doityourself)$"]', '["service:vehicle:oil_change"="yes"]', '["amenity"~"^(toilets|fuel)$"]'];
      const query = `[out:json][timeout:20][maxsize:16777216];(${selectors.map(s => `nwr${s}${around};`).join("")});out center tags 2000;`;
      const url = new URL(process.env.FESTIVAL_OVERPASS_URL ?? "https://overpass.private.coffee/api/interpreter");
      url.searchParams.set("data", query);
      const response = await fetch(url, {
        method: "GET", headers: { Accept: "application/json", "User-Agent": "AdventureZone-FestivalCrew/1.0" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok || Number(response.headers.get("content-length")) > 5_000_000) throw new PlaceProviderError();
      const text = await response.text();
      if (text.length > 5_000_000) throw new PlaceProviderError();
      return { suggestions: parseOverpass(JSON.parse(text), lat, lng, radiusMiles), searchedAt: new Date().toISOString(), radiusMiles };
    });
  }
}
