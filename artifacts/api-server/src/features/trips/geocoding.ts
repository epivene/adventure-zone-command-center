export type GeocodeResult = {
  latitude: number;
  longitude: number;
  displayName: string;
};

/** Thrown when the geocoder cannot return a result. Message is always
 *  sanitized — never contains provider internals. */
export class GeocodingUnavailableError extends Error {
  constructor(public readonly code: "no_results" | "provider_error") {
    super(
      code === "no_results"
        ? "No location found for that query."
        : "Geocoding provider is unavailable.",
    );
    this.name = "GeocodingUnavailableError";
  }
}

export interface GeocodingProvider {
  geocode(query: string): Promise<GeocodeResult[]>;
}

/**
 * Nominatim-based geocoding provider. Uses the same OSM data stack as the
 * OSRM routing provider so coordinates will be compatible with road routing.
 *
 * Nominatim usage policy: one request at a time, include a User-Agent.
 */
export class NominatimGeocodingProvider implements GeocodingProvider {
  constructor(
    private readonly baseUrl = process.env.NOMINATIM_BASE_URL ??
      "https://nominatim.openstreetmap.org",
    private readonly timeoutMs = 8_000,
    private readonly maxResults = 5,
  ) {}

  async geocode(query: string): Promise<GeocodeResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(this.maxResults));
    url.searchParams.set("addressdetails", "0");

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          "User-Agent": "adventure-zone-command-center/1.0",
          Accept: "application/json",
        },
      });
    } catch {
      throw new GeocodingUnavailableError("provider_error");
    }

    if (!response.ok) throw new GeocodingUnavailableError("provider_error");

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GeocodingUnavailableError("provider_error");
    }

    if (!Array.isArray(body)) throw new GeocodingUnavailableError("provider_error");

    const results: GeocodeResult[] = [];
    for (const item of body) {
      const lat = parseFloat(item?.lat);
      const lon = parseFloat(item?.lon);
      const displayName = String(item?.display_name ?? "");
      if (Number.isFinite(lat) && Number.isFinite(lon) && displayName) {
        results.push({ latitude: lat, longitude: lon, displayName });
      }
    }

    if (results.length === 0) throw new GeocodingUnavailableError("no_results");
    return results;
  }
}

/** Deterministic in-memory fake for tests. */
export class FakeGeocodingProvider implements GeocodingProvider {
  public calls = 0;
  constructor(
    private readonly results: Record<string, GeocodeResult[]> = {},
    private readonly available = true,
  ) {}

  async geocode(query: string): Promise<GeocodeResult[]> {
    this.calls += 1;
    if (!this.available) throw new GeocodingUnavailableError("provider_error");
    const found = this.results[query.toLowerCase()];
    if (!found || found.length === 0) throw new GeocodingUnavailableError("no_results");
    return found;
  }
}
