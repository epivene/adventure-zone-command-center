import { eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { routingCacheEntries } from "@/db/schema";

export type LatLng = { latitude: number; longitude: number };

export type RouteLeg = { miles: number; minutes: number };

/** Thrown when the routing provider cannot produce an estimate. Message is
 * always sanitized — never contains provider internals. */
export class RoutingUnavailableError extends Error {
  constructor() {
    super("Routing provider is unavailable.");
    this.name = "RoutingUnavailableError";
  }
}

export interface RoutingProvider {
  /** Real-road distance and drive time. Throws RoutingUnavailableError on any failure. */
  route(from: LatLng, to: LatLng): Promise<RouteLeg>;
}

export interface RoutingCacheStore {
  get(cacheKey: string): Promise<RouteLeg | null>;
  put(cacheKey: string, leg: RouteLeg): Promise<void>;
}

export function coordinateKey(point: LatLng): string {
  return `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`;
}

export function unroutableKey(label: string): string {
  return `label:${label.trim().toLowerCase()}`;
}

const ROUTING_ASSUMPTIONS_VERSION = "osrm-driving-v1";

export function routingCacheKey(fromKey: string, toKey: string): string {
  return `${ROUTING_ASSUMPTIONS_VERSION}:${fromKey}->${toKey}`;
}

const METERS_PER_MILE = 1609.344;

export class OsrmRoutingProvider implements RoutingProvider {
  constructor(
    private readonly baseUrl = process.env.OSRM_BASE_URL ??
      "https://router.project-osrm.org",
    private readonly timeoutMs = 8_000,
  ) {}

  async route(from: LatLng, to: LatLng): Promise<RouteLeg> {
    const path =
      `/route/v1/driving/${from.longitude},${from.latitude};` +
      `${to.longitude},${to.latitude}?overview=false&alternatives=false`;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "User-Agent": "adventure-zone-command-center/1.0" },
      });
      if (!response.ok) throw new RoutingUnavailableError();
      const body = (await response.json()) as {
        code?: string;
        routes?: Array<{ distance?: number; duration?: number }>;
      };
      const route = body.routes?.[0];
      if (
        body.code !== "Ok" ||
        !route ||
        !Number.isFinite(route.distance) ||
        !Number.isFinite(route.duration)
      ) {
        throw new RoutingUnavailableError();
      }
      return {
        miles: (route.distance as number) / METERS_PER_MILE,
        minutes: (route.duration as number) / 60,
      };
    } catch {
      // Sanitize every failure mode (network, timeout, parse) the same way.
      throw new RoutingUnavailableError();
    }
  }
}

type DrizzleDatabase = typeof database;

export class DrizzleRoutingCacheStore implements RoutingCacheStore {
  constructor(private readonly database: DrizzleDatabase) {}

  async get(cacheKey: string): Promise<RouteLeg | null> {
    const [entry] = await this.database
      .select({
        miles: routingCacheEntries.miles,
        minutes: routingCacheEntries.minutes,
      })
      .from(routingCacheEntries)
      .where(eq(routingCacheEntries.cacheKey, cacheKey))
      .limit(1);
    return entry ?? null;
  }

  async put(cacheKey: string, leg: RouteLeg): Promise<void> {
    await this.database
      .insert(routingCacheEntries)
      .values({ cacheKey, miles: leg.miles, minutes: leg.minutes, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: routingCacheEntries.cacheKey,
        set: { miles: leg.miles, minutes: leg.minutes, fetchedAt: new Date() },
      });
  }
}

export type RoutingEstimate = RouteLeg & {
  source: "live" | "cached";
  estimatedAt: Date;
};

/**
 * Cache-backed estimator. `preferLive` requests a fresh provider call first
 * (used on recalculation/refresh so "live" labels are honest); otherwise the
 * cache is consulted first. Returns null only when the provider is
 * unavailable AND no cached value exists — callers must then fall back to
 * manual entry with clear labeling.
 */
export class RoutingEstimator {
  constructor(
    private readonly provider: RoutingProvider,
    private readonly cache: RoutingCacheStore,
  ) {}

  async estimate(
    from: LatLng,
    to: LatLng,
    options: { preferLive: boolean },
  ): Promise<RoutingEstimate | null> {
    const cacheKey = routingCacheKey(coordinateKey(from), coordinateKey(to));
    if (!options.preferLive) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return { ...cached, source: "cached", estimatedAt: new Date() };
    }
    try {
      const live = await this.provider.route(from, to);
      await this.cache.put(cacheKey, live);
      return { ...live, source: "live", estimatedAt: new Date() };
    } catch {
      const cached = await this.cache.get(cacheKey);
      if (cached) return { ...cached, source: "cached", estimatedAt: new Date() };
      return null;
    }
  }
}

/** Deterministic in-memory fakes for tests. */
export class FakeRoutingProvider implements RoutingProvider {
  public calls = 0;
  public available = true;

  constructor(
    private readonly compute: (from: LatLng, to: LatLng) => RouteLeg = (f, t) => {
      const dLat = Math.abs(f.latitude - t.latitude);
      const dLng = Math.abs(f.longitude - t.longitude);
      const miles = Math.round((dLat + dLng) * 69 * 100) / 100;
      return { miles, minutes: miles * 1.2 };
    },
  ) {}

  async route(from: LatLng, to: LatLng): Promise<RouteLeg> {
    this.calls += 1;
    if (!this.available) throw new RoutingUnavailableError();
    return this.compute(from, to);
  }
}

export class InMemoryRoutingCacheStore implements RoutingCacheStore {
  private readonly entries = new Map<string, RouteLeg>();
  async get(cacheKey: string): Promise<RouteLeg | null> {
    return this.entries.get(cacheKey) ?? null;
  }
  async put(cacheKey: string, leg: RouteLeg): Promise<void> {
    this.entries.set(cacheKey, leg);
  }
}
