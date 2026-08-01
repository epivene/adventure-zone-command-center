import { eq, inArray, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { routingCacheEntries, tripSegments } from "@/db/schema";
import type { TransferTimeLookup } from "@/features/resources/resource-conflicts";
import type { ResourceReservation } from "@/features/resources/resource-types";
import { coordinateKey, routingCacheKey } from "./routing";
import { effectiveSegmentEstimate } from "./trip-math";

type DrizzleDatabase = typeof database;

/**
 * Transfer-time estimates for resource conflict checks, backed by trip
 * planning data. Order of preference:
 * 1. A trip segment whose endpoints match the two booking locations
 *    (manual overrides label the estimate "manual").
 * 2. The routing cache ("cached").
 * Returns null when neither exists — conflict checks then surface the
 * "trip estimate missing" warning instead of guessing.
 */
export function createTripTransferTimeLookup(
  db: DrizzleDatabase,
): TransferTimeLookup {
  return {
    async estimateMinutes(from: ResourceReservation, to: ResourceReservation) {
      if (!from.location || !to.location) return null;
      const fromKey = coordinateKey(from.location);
      const toKey = coordinateKey(to.location);

      const segments = await db
        .select()
        .from(tripSegments)
        .where(or(
          eq(tripSegments.fromKey, fromKey),
          eq(tripSegments.toKey, toKey),
        ));
      const matches = segments
        .filter(
          (segment) =>
            (segment.fromKey === fromKey && segment.toKey === toKey) ||
            (segment.fromKey === toKey && segment.toKey === fromKey),
        )
        .map((segment) => effectiveSegmentEstimate(segment))
        .filter((estimate) => estimate.minutes !== null)
        .sort((first, second) => {
          const rank = (source: string | null) => (source === "manual" ? 0 : 1);
          return (
            rank(first.source) - rank(second.source) ||
            (first.minutes ?? 0) - (second.minutes ?? 0)
          );
        });
      const best = matches[0];
      if (best && best.minutes !== null) {
        return {
          minutes: best.minutes,
          source: best.source === "manual" ? ("manual" as const) : ("cached" as const),
        };
      }

      const cacheEntries = await db
        .select({
          cacheKey: routingCacheEntries.cacheKey,
          minutes: routingCacheEntries.minutes,
        })
        .from(routingCacheEntries)
        .where(inArray(routingCacheEntries.cacheKey, [
          routingCacheKey(fromKey, toKey),
          routingCacheKey(toKey, fromKey),
        ]));
      const cached = cacheEntries.sort(
        (first, second) => first.minutes - second.minutes,
      )[0];
      if (cached) return { minutes: cached.minutes, source: "cached" as const };
      return null;
    },
  };
}
