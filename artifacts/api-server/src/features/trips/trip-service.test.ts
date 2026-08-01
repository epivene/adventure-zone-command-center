import { describe, expect, it } from "vitest";

import {
  FakeRoutingProvider,
  InMemoryRoutingCacheStore,
  RoutingEstimator,
} from "./routing";
import type {
  NewTripSegment,
  TripAuditChange,
  TripRecord,
  TripRepository,
  TripResourceRecord,
  TripSegmentRecord,
  TripStopRecord,
} from "./trip-repository";
import { TripService } from "./trip-service";

const denver = { latitude: 39.7392, longitude: -104.9903 };
const springs = { latitude: 38.8339, longitude: -104.8214 };
const pueblo = { latitude: 38.2544, longitude: -104.6091 };

class FakeTripRepository implements TripRepository {
  trips = new Map<string, TripRecord>();
  stops = new Map<string, TripStopRecord[]>();
  segments = new Map<string, TripSegmentRecord[]>();
  resources = new Map<string, TripResourceRecord[]>();
  auditLog: TripAuditChange[] = [];
  private nextId = 1;

  private id() {
    return `00000000-0000-0000-0000-${String(this.nextId++).padStart(12, "0")}`;
  }

  async createTrip(
    values: Omit<TripRecord, "id" | "createdAt" | "updatedAt" | "routeConfirmedAt">,
  ): Promise<TripRecord> {
    const trip: TripRecord = {
      ...values,
      id: this.id(),
      routeConfirmedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.trips.set(trip.id, trip);
    this.stops.set(trip.id, []);
    this.segments.set(trip.id, []);
    return trip;
  }

  async getTrip(id: string) {
    return this.trips.get(id) ?? null;
  }

  async listTrips() {
    return [...this.trips.values()].map((trip) => ({
      ...trip,
      legName: "Leg",
      legColor: "#000",
      stopCount: this.stops.get(trip.id)?.length ?? 0,
    }));
  }

  async updateTrip(id: string, values: Partial<TripRecord>) {
    const trip = this.trips.get(id);
    if (!trip) return null;
    const updated = { ...trip, ...values, updatedAt: new Date() };
    this.trips.set(id, updated);
    return updated;
  }

  async deleteTrip(id: string) {
    return this.trips.delete(id);
  }

  async listStops(tripId: string) {
    return [...(this.stops.get(tripId) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
  }

  addStopRecord(tripId: string, stop: Omit<TripStopRecord, "id" | "tripId" | "sortOrder">) {
    const list = this.stops.get(tripId) ?? [];
    const record: TripStopRecord = {
      ...stop,
      id: this.id(),
      tripId,
      sortOrder: list.length + 1,
    };
    list.push(record);
    this.stops.set(tripId, list);
    return record;
  }

  async addStop(tripId: string, bookingId: string) {
    const list = this.stops.get(tripId) ?? [];
    if (list.some((stop) => stop.bookingId === bookingId)) return null;
    return this.addStopRecord(tripId, {
      bookingId,
      bookingName: `Booking ${bookingId}`,
      city: "City",
      region: "CO",
      latitude: null,
      longitude: null,
      startsAt: null,
      endsAt: null,
      status: "confirmed",
    });
  }

  async removeStop(tripId: string, stopId: string) {
    const list = this.stops.get(tripId) ?? [];
    const filtered = list.filter((stop) => stop.id !== stopId);
    if (filtered.length === list.length) return false;
    filtered.forEach((stop, index) => (stop.sortOrder = index + 1));
    this.stops.set(tripId, filtered);
    return true;
  }

  async setStopOrder(tripId: string, orderedStopIds: readonly string[]) {
    const list = this.stops.get(tripId) ?? [];
    if (
      list.length !== orderedStopIds.length ||
      orderedStopIds.some((id) => !list.some((stop) => stop.id === id))
    ) {
      return false;
    }
    for (const stop of list) {
      stop.sortOrder = orderedStopIds.indexOf(stop.id) + 1;
    }
    return true;
  }

  async listSegments(tripId: string) {
    return [...(this.segments.get(tripId) ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    );
  }

  async replaceSegments(tripId: string, segments: readonly NewTripSegment[]) {
    this.segments.set(
      tripId,
      segments.map((segment) => ({ ...segment, id: this.id(), tripId })),
    );
  }

  async updateSegmentOverride(
    tripId: string,
    segmentId: string,
    override: { overrideMiles: number | null; overrideMinutes: number | null },
  ) {
    const segment = (this.segments.get(tripId) ?? []).find(
      ({ id }) => id === segmentId,
    );
    if (!segment) return null;
    Object.assign(segment, override);
    return segment;
  }

  async listResources(tripId: string) {
    return this.resources.get(tripId) ?? [];
  }

  async addResource(tripId: string, resourceId: string) {
    const list = this.resources.get(tripId) ?? [];
    if (list.some((record) => record.resourceId === resourceId)) return null;
    const record: TripResourceRecord = {
      assignmentId: this.id(),
      resourceId,
      code: "paintball_trailer",
      name: "Paintball trailer",
      category: "trailer",
      movable: true,
    };
    list.push(record);
    this.resources.set(tripId, list);
    return record;
  }

  async removeResource(tripId: string, resourceId: string) {
    const list = this.resources.get(tripId) ?? [];
    const filtered = list.filter((record) => record.resourceId !== resourceId);
    this.resources.set(tripId, filtered);
    return filtered.length !== list.length;
  }

  async audit(change: TripAuditChange) {
    this.auditLog.push(change);
  }
}

const leg = {
  id: "00000000-0000-0000-0000-00000000leg1",
  name: "Front Range",
  baseAddress: "Denver HQ",
  defaultVehicleName: "Box truck",
  defaultMpg: 9,
};

function makeService(provider = new FakeRoutingProvider()) {
  const repository = new FakeTripRepository();
  const estimator = new RoutingEstimator(provider, new InMemoryRoutingCacheStore());
  return { repository, provider, service: new TripService(repository, estimator) };
}

async function makeTripWithStops(context: ReturnType<typeof makeService>) {
  const trip = await context.service.createTrip({
    leg,
    name: "August run",
    startDate: new Date("2026-08-10T00:00:00Z"),
    endDate: new Date("2026-08-12T00:00:00Z"),
    start: { label: "Denver HQ", ...denver },
    end: { label: "Denver HQ", ...denver },
  });
  const stopA = context.repository.addStopRecord(trip.id, {
    bookingId: "00000000-0000-0000-0000-0000000000b1",
    bookingName: "Springs Fair",
    city: "Colorado Springs",
    region: "CO",
    ...springs,
    startsAt: new Date("2026-08-10T16:00:00Z"),
    endsAt: null,
    status: "confirmed",
  });
  const stopB = context.repository.addStopRecord(trip.id, {
    bookingId: "00000000-0000-0000-0000-0000000000b2",
    bookingName: "Pueblo Festival",
    city: "Pueblo",
    region: "CO",
    ...pueblo,
    startsAt: new Date("2026-08-11T16:00:00Z"),
    endsAt: null,
    status: "confirmed",
  });
  await context.service.recalculateSegments(trip.id, { preferLive: true });
  return { trip, stopA, stopB };
}

describe("TripService", () => {
  it("creates a trip defaulting start/end to the leg base and snapshots vehicle/MPG", async () => {
    const { service } = makeService();
    const trip = await service.createTrip({
      leg,
      name: "Test trip",
      startDate: new Date("2026-08-10T00:00:00Z"),
      endDate: new Date("2026-08-11T00:00:00Z"),
    });
    expect(trip.startLabel).toBe("Denver HQ");
    expect(trip.endLabel).toBe("Denver HQ");
    expect(trip.vehicleName).toBe("Box truck");
    expect(trip.mpg).toBe(9);
  });

  it("builds a round-trip segment chain with live labels and fuel totals", async () => {
    const context = makeService();
    const { trip } = await makeTripWithStops(context);
    const detail = await context.service.getTripDetail(trip.id);
    expect(detail!.segments).toHaveLength(3);
    expect(detail!.segments.map((s) => s.effectiveSource)).toEqual([
      "live",
      "live",
      "live",
    ]);
    expect(detail!.totals.miles).toBeGreaterThan(0);
    expect(detail!.totals.gallons).toBeCloseTo(detail!.totals.miles / 9, 6);
    expect(detail!.totals.incomplete).toBe(false);
  });

  it("manual reorder confirms the route and suggestion refuses to rearrange it", async () => {
    const context = makeService();
    const { trip, stopA, stopB } = await makeTripWithStops(context);
    const reordered = await context.service.reorderStops(trip.id, [stopB.id, stopA.id]);
    expect(reordered).toBe(true);
    const confirmed = await context.repository.getTrip(trip.id);
    expect(confirmed!.routeConfirmedAt).not.toBeNull();

    const refused = await context.service.applySuggestedOrder(trip.id, { force: false });
    expect(refused).toEqual({ ok: false, error: "ROUTE_CONFIRMED" });
    const stops = await context.repository.listStops(trip.id);
    expect(stops.map(({ id }) => id)).toEqual([stopB.id, stopA.id]);

    const forced = await context.service.applySuggestedOrder(trip.id, { force: true });
    expect(forced).toEqual({ ok: true });
    const suggested = await context.repository.listStops(trip.id);
    expect(suggested.map(({ id }) => id)).toEqual([stopA.id, stopB.id]);
  });

  it("falls back to labeled cached estimates when the provider goes down", async () => {
    const context = makeService();
    const { trip } = await makeTripWithStops(context);
    context.provider.available = false;
    await context.service.refreshEstimates(trip.id);
    const detail = await context.service.getTripDetail(trip.id);
    expect(detail!.segments.map((s) => s.effectiveSource)).toEqual([
      "cached",
      "cached",
      "cached",
    ]);
    expect(detail!.totals.miles).toBeGreaterThan(0);
  });

  it("leaves segments blank (never straight-line) when provider is down with no cache", async () => {
    const provider = new FakeRoutingProvider();
    provider.available = false;
    const context = makeService(provider);
    const { trip } = await makeTripWithStops(context);
    const detail = await context.service.getTripDetail(trip.id);
    expect(detail!.segments.every((s) => s.effectiveSource === null)).toBe(true);
    expect(detail!.segments.every((s) => s.effectiveMiles === null)).toBe(true);
    expect(detail!.totals.incomplete).toBe(true);
  });

  it("labels manual overrides and preserves them across recalculation", async () => {
    const context = makeService();
    const { trip } = await makeTripWithStops(context);
    const segments = await context.repository.listSegments(trip.id);
    await context.service.overrideSegment(trip.id, segments[0]!.id, {
      overrideMiles: 42,
      overrideMinutes: 55,
    });
    await context.service.refreshEstimates(trip.id);
    const detail = await context.service.getTripDetail(trip.id);
    expect(detail!.segments[0]!.effectiveSource).toBe("manual");
    expect(detail!.segments[0]!.effectiveMiles).toBe(42);
    expect(detail!.segments[0]!.effectiveMinutes).toBe(55);
    expect(context.repository.auditLog.some((c) => c.action === "segment_override")).toBe(true);
  });

  it("changing MPG/fuel price re-labels nothing and does not touch segments", async () => {
    const context = makeService();
    const { trip } = await makeTripWithStops(context);
    const before = await context.repository.listSegments(trip.id);
    await context.service.updateTrip(trip.id, { mpg: 12, fuelPricePerGallon: 3 });
    const after = await context.repository.listSegments(trip.id);
    expect(after).toEqual(before);
    const detail = await context.service.getTripDetail(trip.id);
    expect(detail!.totals.gallons).toBeCloseTo(detail!.totals.miles / 12, 6);
    expect(detail!.totals.cost).toBeCloseTo((detail!.totals.miles / 12) * 3, 6);
  });
});
