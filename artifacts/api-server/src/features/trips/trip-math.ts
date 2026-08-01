import type { LatLng } from "./routing";

export type TripEstimateSource = "live" | "cached" | "manual";

export function haversineMiles(from: LatLng, to: LatLng): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type SuggestableStop = {
  id: string;
  name: string;
  startsAt: Date | null;
  coordinates: LatLng | null;
};

/**
 * Suggested stop order: earlier event dates first (undated last), and within
 * each date group a greedy nearest-neighbor chain from the current position.
 * This is a heuristic ordering only — displayed distances always come from the
 * routing provider, cache, or manual entry, never from this straight-line math.
 */
export function suggestStopOrder(
  stops: readonly SuggestableStop[],
  start: LatLng | null,
): string[] {
  const dateKey = (stop: SuggestableStop) =>
    stop.startsAt ? stop.startsAt.toISOString().slice(0, 10) : "9999-99-99";
  const groups = new Map<string, SuggestableStop[]>();
  for (const stop of stops) {
    const key = dateKey(stop);
    const group = groups.get(key) ?? [];
    group.push(stop);
    groups.set(key, group);
  }

  const ordered: string[] = [];
  let position = start;
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key)!;
    const withCoordinates = group.filter((stop) => stop.coordinates !== null);
    const withoutCoordinates = group
      .filter((stop) => stop.coordinates === null)
      .sort(
        (first, second) =>
          first.name.localeCompare(second.name) || first.id.localeCompare(second.id),
      );

    const remaining = [...withCoordinates];
    while (remaining.length > 0) {
      remaining.sort((first, second) => {
        if (position) {
          const difference =
            haversineMiles(position, first.coordinates!) -
            haversineMiles(position, second.coordinates!);
          if (Math.abs(difference) > 1e-9) return difference;
        }
        return (
          first.name.localeCompare(second.name) || first.id.localeCompare(second.id)
        );
      });
      const next = remaining.shift()!;
      ordered.push(next.id);
      position = next.coordinates;
    }
    for (const stop of withoutCoordinates) ordered.push(stop.id);
  }
  return ordered;
}

export type SegmentLike = {
  miles: number | null;
  minutes: number | null;
  source: TripEstimateSource | null;
  overrideMiles: number | null;
  overrideMinutes: number | null;
};

export type EffectiveSegmentEstimate = {
  miles: number | null;
  minutes: number | null;
  /** Label shown to the user; null means no estimate exists yet. */
  source: TripEstimateSource | null;
};

/** Manual overrides win and force the "manual" label. */
export function effectiveSegmentEstimate(
  segment: SegmentLike,
): EffectiveSegmentEstimate {
  const hasOverride =
    segment.overrideMiles !== null || segment.overrideMinutes !== null;
  if (hasOverride) {
    return {
      miles: segment.overrideMiles ?? segment.miles,
      minutes: segment.overrideMinutes ?? segment.minutes,
      source: "manual",
    };
  }
  if (segment.miles === null && segment.minutes === null) {
    return { miles: null, minutes: null, source: null };
  }
  return { miles: segment.miles, minutes: segment.minutes, source: segment.source };
}

export type FuelEstimate = { gallons: number; cost: number | null };

export function fuelEstimate(
  miles: number | null,
  mpg: number | null,
  fuelPricePerGallon: number | null,
): FuelEstimate | null {
  if (miles === null || mpg === null || mpg <= 0) return null;
  const gallons = miles / mpg;
  return {
    gallons,
    cost: fuelPricePerGallon === null ? null : gallons * fuelPricePerGallon,
  };
}

export type TripTotals = {
  miles: number;
  minutes: number;
  gallons: number | null;
  cost: number | null;
  /** True when at least one segment has no usable estimate yet. */
  incomplete: boolean;
};

export function tripTotals(
  segments: readonly SegmentLike[],
  mpg: number | null,
  fuelPricePerGallon: number | null,
): TripTotals {
  let miles = 0;
  let minutes = 0;
  let incomplete = segments.length === 0;
  for (const segment of segments) {
    const effective = effectiveSegmentEstimate(segment);
    if (effective.miles === null) incomplete = true;
    else miles += effective.miles;
    if (effective.minutes === null) incomplete = true;
    else minutes += effective.minutes;
  }
  const fuel = fuelEstimate(miles, mpg, fuelPricePerGallon);
  return {
    miles,
    minutes,
    gallons: fuel?.gallons ?? null,
    cost: fuel?.cost ?? null,
    incomplete,
  };
}
