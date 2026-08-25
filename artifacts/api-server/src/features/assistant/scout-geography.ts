export type ScoutPoint = {
  latitude: number;
  longitude: number;
};

export type ResolvedScoutLocation = ScoutPoint & {
  displayName: string;
};

export type ScoutSearchPlace = ScoutPoint & {
  name: string;
  placeType: string;
  distanceMiles: number;
};

const EARTH_RADIUS_MILES = 3958.7613;

function radians(value: number) {
  return value * Math.PI / 180;
}

export function distanceMiles(a: ScoutPoint, b: ScoutPoint): number {
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

export function withinRadius(anchor: ScoutPoint, candidate: ScoutPoint, radiusMiles: number): boolean {
  return distanceMiles(anchor, candidate) <= radiusMiles;
}

type NominatimRow = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: {
    name?: string;
    place?: string;
    boundary?: string;
    admin_level?: string;
  };
};

type OverpassPayload = { elements?: OverpassElement[] };

export class ScoutGeocoder {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async resolve(query: string, signal?: AbortSignal): Promise<ResolvedScoutLocation | null> {
    const value = query.trim();
    if (!value) return null;
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "us");
    url.searchParams.set("q", value);
    const response = await this.fetchFn(url, {
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.8",
        "user-agent": "AdventureZoneCommandCenter/1.0",
      },
      signal,
    });
    if (!response.ok) throw new Error(`SCOUT_GEOCODER_FAILED_${response.status}`);
    const rows = await response.json() as NominatimRow[];
    const row = rows[0];
    if (!row?.lat || !row.lon) return null;
    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      displayName: row.display_name?.trim() || value,
    };
  }
}

export class ScoutAreaResolver {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async listPlaces(anchor: ScoutPoint, radiusMiles: number, signal?: AbortSignal): Promise<ScoutSearchPlace[]> {
    const radiusMeters = Math.max(1, Math.round(radiusMiles * 1609.344));
    const query = `[out:json][timeout:25];(
      node["place"~"^(city|town|village|hamlet)$"](around:${radiusMeters},${anchor.latitude},${anchor.longitude});
      relation["boundary"="administrative"]["admin_level"="6"](around:${radiusMeters},${anchor.latitude},${anchor.longitude});
    );out center tags;`;
    const response = await this.fetchFn("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "AdventureZoneCommandCenter/1.0",
      },
      body: new URLSearchParams({ data: query }),
      signal,
    });
    if (!response.ok) throw new Error(`SCOUT_AREA_LOOKUP_FAILED_${response.status}`);
    const payload = await response.json() as OverpassPayload;
    const unique = new Map<string, ScoutSearchPlace>();
    for (const element of payload.elements ?? []) {
      const name = element.tags?.name?.trim();
      if (!name) continue;
      const isCounty = element.tags?.boundary === "administrative" && element.tags?.admin_level === "6";
      const placeType = isCounty ? "county" : element.tags?.place?.trim();
      if (!placeType) continue;
      const rawLat = element.lat ?? element.center?.lat;
      const rawLon = element.lon ?? element.center?.lon;
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLon)) continue;
      const point = { latitude: Number(rawLat), longitude: Number(rawLon) };
      const miles = distanceMiles(anchor, point);
      // Named communities are point locations and must be inside the circle.
      // County relations are returned by Overpass because their boundary intersects
      // the requested circle, so keep them even when the relation center is outside it.
      if (!isCounty && miles > radiusMiles) continue;
      const key = `${placeType}:${name.toLowerCase()}`;
      const next: ScoutSearchPlace = { name, placeType, ...point, distanceMiles: miles };
      const current = unique.get(key);
      if (!current || next.distanceMiles < current.distanceMiles) unique.set(key, next);
    }
    return [...unique.values()]
      .sort((a, b) => {
        if (a.placeType === "county" && b.placeType !== "county") return 1;
        if (b.placeType === "county" && a.placeType !== "county") return -1;
        return a.distanceMiles - b.distanceMiles || a.name.localeCompare(b.name);
      })
      .slice(0, 160);
  }
}
