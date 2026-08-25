export type ScoutPoint = {
  latitude: number;
  longitude: number;
};

export type ResolvedScoutLocation = ScoutPoint & {
  displayName: string;
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
