import type { LatLng, RoutingEstimator } from "./routing";
import { coordinateKey, unroutableKey } from "./routing";
import {
  effectiveSegmentEstimate,
  fuelEstimate,
  suggestStopOrder,
  tripTotals,
  type TripTotals,
} from "./trip-math";
import type {
  NewTripSegment,
  TripRecord,
  TripRepository,
  TripSegmentRecord,
  TripStopRecord,
} from "./trip-repository";

export type RoutePoint = {
  key: string;
  label: string;
  coordinates: LatLng | null;
};

export type TripSegmentView = TripSegmentRecord & {
  effectiveMiles: number | null;
  effectiveMinutes: number | null;
  effectiveSource: "live" | "cached" | "manual" | null;
  gallons: number | null;
  fuelCost: number | null;
};

export type TripDetail = {
  trip: TripRecord;
  stops: TripStopRecord[];
  segments: TripSegmentView[];
  totals: TripTotals;
};

export type LegDefaults = {
  id: string;
  name: string;
  baseAddress: string | null;
  defaultVehicleName: string | null;
  defaultMpg: number | null;
};

function point(
  label: string,
  latitude: number | null,
  longitude: number | null,
): RoutePoint {
  const coordinates =
    latitude !== null &&
    longitude !== null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;
  return {
    key: coordinates ? coordinateKey(coordinates) : unroutableKey(label),
    label,
    coordinates,
  };
}

export function buildRoutePoints(
  trip: TripRecord,
  stops: readonly TripStopRecord[],
): RoutePoint[] {
  return [
    point(trip.startLabel, trip.startLatitude, trip.startLongitude),
    ...stops.map((stop) =>
      point(
        `${stop.bookingName} (${stop.city}, ${stop.region})`,
        stop.latitude,
        stop.longitude,
      ),
    ),
    point(trip.endLabel, trip.endLatitude, trip.endLongitude),
  ];
}

export class TripService {
  constructor(
    private readonly repository: TripRepository,
    private readonly estimator: RoutingEstimator,
  ) {}

  async createTrip(input: {
    leg: LegDefaults;
    name: string;
    startDate: Date;
    endDate: Date;
    start?: { label: string; latitude: number | null; longitude: number | null };
    end?: { label: string; latitude: number | null; longitude: number | null };
    vehicleName?: string | null;
    mpg?: number | null;
    fuelPricePerGallon?: number | null;
    notes?: string | null;
  }): Promise<TripRecord> {
    const baseLabel = input.leg.baseAddress?.trim() || `${input.leg.name} base`;
    const start = input.start ?? { label: baseLabel, latitude: null, longitude: null };
    const end = input.end ?? { label: baseLabel, latitude: null, longitude: null };
    const trip = await this.repository.createTrip({
      travelLegId: input.leg.id,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      startLabel: start.label,
      startLatitude: start.latitude,
      startLongitude: start.longitude,
      endLabel: end.label,
      endLatitude: end.latitude,
      endLongitude: end.longitude,
      vehicleName: input.vehicleName ?? input.leg.defaultVehicleName,
      mpg: input.mpg ?? input.leg.defaultMpg,
      fuelPricePerGallon: input.fuelPricePerGallon ?? null,
      notes: input.notes ?? null,
    });
    await this.repository.audit({
      entityId: trip.id,
      action: "create",
      before: null,
      after: { name: trip.name, travelLegId: trip.travelLegId },
    });
    return trip;
  }

  async updateTrip(
    tripId: string,
    values: Partial<
      Pick<
        TripRecord,
        | "name"
        | "startDate"
        | "endDate"
        | "startLabel"
        | "startLatitude"
        | "startLongitude"
        | "endLabel"
        | "endLatitude"
        | "endLongitude"
        | "vehicleName"
        | "mpg"
        | "fuelPricePerGallon"
        | "notes"
      >
    >,
  ): Promise<TripRecord | null> {
    const before = await this.repository.getTrip(tripId);
    if (!before) return null;
    const updated = await this.repository.updateTrip(tripId, values);
    if (!updated) return null;
    await this.repository.audit({
      entityId: tripId,
      action: "update",
      before: { ...values, previous: pickChanged(before, values) },
      after: values as Record<string, unknown>,
    });
    const endpointsChanged = [
      "startLabel",
      "startLatitude",
      "startLongitude",
      "endLabel",
      "endLatitude",
      "endLongitude",
    ].some((field) => field in values);
    if (endpointsChanged) {
      await this.recalculateSegments(tripId, { preferLive: true });
    }
    return this.repository.getTrip(tripId);
  }

  async addStop(tripId: string, bookingId: string): Promise<boolean> {
    const stop = await this.repository.addStop(tripId, bookingId);
    if (!stop) return false;
    await this.recalculateSegments(tripId, { preferLive: true });
    return true;
  }

  async removeStop(tripId: string, stopId: string): Promise<boolean> {
    const removed = await this.repository.removeStop(tripId, stopId);
    if (!removed) return false;
    await this.recalculateSegments(tripId, { preferLive: true });
    return true;
  }

  /** Manual reorder confirms the route — it is never rearranged automatically after this. */
  async reorderStops(
    tripId: string,
    orderedStopIds: readonly string[],
  ): Promise<boolean> {
    const applied = await this.repository.setStopOrder(tripId, orderedStopIds);
    if (!applied) return false;
    await this.repository.updateTrip(tripId, { routeConfirmedAt: new Date() });
    await this.repository.audit({
      entityId: tripId,
      action: "route_confirmed",
      before: null,
      after: { orderedStopIds: [...orderedStopIds] },
    });
    await this.recalculateSegments(tripId, { preferLive: true });
    return true;
  }

  /**
   * Applies the suggested order. Refused for confirmed routes unless `force`
   * (an explicit user action) — a confirmed route is never rearranged
   * automatically. Suggestion-applied routes stay unconfirmed.
   */
  async applySuggestedOrder(
    tripId: string,
    options: { force: boolean },
  ): Promise<{ ok: true } | { ok: false; error: "TRIP_NOT_FOUND" | "ROUTE_CONFIRMED" }> {
    const trip = await this.repository.getTrip(tripId);
    if (!trip) return { ok: false, error: "TRIP_NOT_FOUND" };
    if (trip.routeConfirmedAt && !options.force) {
      return { ok: false, error: "ROUTE_CONFIRMED" };
    }
    const stops = await this.repository.listStops(tripId);
    const start =
      trip.startLatitude !== null && trip.startLongitude !== null
        ? { latitude: trip.startLatitude, longitude: trip.startLongitude }
        : null;
    const orderedIds = suggestStopOrder(
      stops.map((stop) => ({
        id: stop.id,
        name: stop.bookingName,
        startsAt: stop.startsAt,
        coordinates:
          stop.latitude !== null && stop.longitude !== null
            ? { latitude: stop.latitude, longitude: stop.longitude }
            : null,
      })),
      start,
    );
    await this.repository.setStopOrder(tripId, orderedIds);
    if (options.force) {
      // Explicit user choice on a confirmed route clears confirmation.
      await this.repository.updateTrip(tripId, { routeConfirmedAt: null });
    }
    await this.repository.audit({
      entityId: tripId,
      action: "suggested_order_applied",
      before: null,
      after: { orderedStopIds: orderedIds, forced: options.force },
    });
    await this.recalculateSegments(tripId, { preferLive: true });
    return { ok: true };
  }

  async refreshEstimates(tripId: string): Promise<void> {
    await this.recalculateSegments(tripId, { preferLive: true });
  }

  async overrideSegment(
    tripId: string,
    segmentId: string,
    override: { overrideMiles: number | null; overrideMinutes: number | null },
  ): Promise<TripSegmentRecord | null> {
    const updated = await this.repository.updateSegmentOverride(
      tripId,
      segmentId,
      override,
    );
    if (updated) {
      await this.repository.audit({
        entityId: tripId,
        action: "segment_override",
        before: null,
        after: {
          segmentId,
          fromLabel: updated.fromLabel,
          toLabel: updated.toLabel,
          overrideMiles: override.overrideMiles,
          overrideMinutes: override.overrideMinutes,
        },
      });
    }
    return updated;
  }

  async getTripDetail(tripId: string): Promise<TripDetail | null> {
    const trip = await this.repository.getTrip(tripId);
    if (!trip) return null;
    const [stops, segments] = await Promise.all([
      this.repository.listStops(tripId),
      this.repository.listSegments(tripId),
    ]);
    const segmentViews = segments.map((segment) => {
      const effective = effectiveSegmentEstimate(segment);
      const fuel = fuelEstimate(effective.miles, trip.mpg, trip.fuelPricePerGallon);
      return {
        ...segment,
        effectiveMiles: effective.miles,
        effectiveMinutes: effective.minutes,
        effectiveSource: effective.source,
        gallons: fuel?.gallons ?? null,
        fuelCost: fuel?.cost ?? null,
      };
    });
    return {
      trip,
      stops,
      segments: segmentViews,
      totals: tripTotals(segments, trip.mpg, trip.fuelPricePerGallon),
    };
  }

  /**
   * Rebuilds the segment chain start → stops → end. Live estimates are
   * fetched (falling back to labeled cached values); when neither is
   * available the segment is left blank for labeled manual entry — never an
   * unlabeled straight-line distance. Manual overrides are preserved across
   * recalculation when the segment endpoints are unchanged.
   */
  async recalculateSegments(
    tripId: string,
    options: { preferLive: boolean },
  ): Promise<void> {
    const trip = await this.repository.getTrip(tripId);
    if (!trip) return;
    const [stops, previousSegments] = await Promise.all([
      this.repository.listStops(tripId),
      this.repository.listSegments(tripId),
    ]);
    const previousByEndpoints = new Map(
      previousSegments.map((segment) => [
        `${segment.fromKey}->${segment.toKey}`,
        segment,
      ]),
    );
    const points = buildRoutePoints(trip, stops);
    const segments: NewTripSegment[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const previous = previousByEndpoints.get(`${from.key}->${to.key}`);
      let miles: number | null = null;
      let minutes: number | null = null;
      let source: "live" | "cached" | "manual" | null = null;
      let estimatedAt: Date | null = null;
      if (from.coordinates && to.coordinates) {
        const estimate = await this.estimator.estimate(
          from.coordinates,
          to.coordinates,
          { preferLive: options.preferLive },
        );
        if (estimate) {
          miles = estimate.miles;
          minutes = estimate.minutes;
          source = estimate.source;
          estimatedAt = estimate.estimatedAt;
        } else if (previous && previous.miles !== null) {
          // Provider down and nothing cached under this key any more —
          // keep the previous stored value, labeled as cached.
          miles = previous.miles;
          minutes = previous.minutes;
          source = "cached";
          estimatedAt = previous.estimatedAt;
        }
      }
      segments.push({
        sequence: index + 1,
        fromKey: from.key,
        toKey: to.key,
        fromLabel: from.label,
        toLabel: to.label,
        miles,
        minutes,
        source,
        estimatedAt,
        overrideMiles: previous?.overrideMiles ?? null,
        overrideMinutes: previous?.overrideMinutes ?? null,
      });
    }
    await this.repository.replaceSegments(tripId, segments);
  }
}

function pickChanged(
  before: TripRecord,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    changed[key] = (before as Record<string, unknown>)[key] ?? null;
  }
  return changed;
}
