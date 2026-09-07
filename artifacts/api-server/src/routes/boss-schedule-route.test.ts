import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => ({
  bookings: {
    id: "bookings.id",
    name: "bookings.name",
    city: "bookings.city",
    region: "bookings.region",
    latitude: "bookings.latitude",
    longitude: "bookings.longitude",
    startsAt: "bookings.startsAt",
    endsAt: "bookings.endsAt",
    status: "bookings.status",
    probability: "bookings.probability",
    travelLegId: "bookings.travelLegId",
  },
  contacts: { id: "contacts.id" },
  travelLegs: {
    id: "travelLegs.id",
    sortOrder: "travelLegs.sortOrder",
    archivedAt: "travelLegs.archivedAt",
  },
  trips: { id: "trips.id", name: "trips.name", travelLegId: "trips.travelLegId" },
}));

const legs = [{
  id: "leg-kristy",
  name: "Kristy",
  color: "#dc2626",
  sortOrder: 1,
  archivedAt: null,
  baseAddress: null,
  defaultVehicleName: null,
  defaultMpg: null,
}, {
  id: "leg-hulk",
  name: "Hulk",
  color: "#2563eb",
  sortOrder: 2,
  archivedAt: null,
  baseAddress: null,
  defaultVehicleName: null,
  defaultMpg: null,
}];

const rawEvents = [{
  id: "booking-kristy",
  name: "Moorcroft Jubilee Days",
  city: "Moorcroft",
  region: "WY",
  latitude: null,
  longitude: null,
  startsAt: new Date("2026-07-09T12:00:00.000Z"),
  endsAt: new Date("2026-07-11T12:00:00.000Z"),
  status: "confirmed",
  probability: "definite",
  travelLegId: "leg-kristy",
  travelLegName: "Kristy",
  travelLegColor: "#dc2626",
  travelLegAssignmentKind: "assigned",
  legAssignmentWarning: null,
  legAssignmentExplanation: null,
  routeBucket: "confirmed",
  locationQuality: "city",
  locationLabel: "Moorcroft, WY",
  seasonYear: 2026,
}, {
  id: "booking-hulk",
  name: "Caribou County Fair",
  city: "Grace",
  region: "ID",
  latitude: null,
  longitude: null,
  startsAt: new Date("2026-07-25T12:00:00.000Z"),
  endsAt: new Date("2026-07-27T12:00:00.000Z"),
  status: "confirmed",
  probability: "definite",
  travelLegId: "leg-hulk",
  travelLegName: "Hulk",
  travelLegColor: "#2563eb",
  travelLegAssignmentKind: "assigned",
  legAssignmentWarning: null,
  legAssignmentExplanation: null,
  routeBucket: "confirmed",
  locationQuality: "city",
  locationLabel: "Grace, ID",
  seasonYear: 2026,
}];

const resolvedEvents = [{
  ...rawEvents[0],
  latitude: 44.2633,
  longitude: -104.9505,
  mappingState: "mapped_city",
}, {
  ...rawEvents[1],
  latitude: 42.576,
  longitude: -111.729,
  mappingState: "mapped_city",
}];

const mocks = vi.hoisted(() => ({
  listTravelLegs: vi.fn(),
  listMapEvents: vi.fn(),
  resolveRouteMapEvents: vi.fn(),
}));

vi.mock("@/db/schema", () => tables);
vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
  gte: vi.fn(() => "gte"),
  isNull: vi.fn(() => "isNull"),
  lt: vi.fn(() => "lt"),
  notInArray: vi.fn(() => "notInArray"),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => {
      let table: unknown;
      const query = {
        from(nextTable: unknown) {
          table = nextTable;
          return query;
        },
        where() {
          return query;
        },
        orderBy() {
          return query;
        },
        limit() {
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          const value = table === tables.bookings
            ? [rawEvents[0]]
            : table === tables.travelLegs
              ? legs
              : [];
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return query;
    }),
  },
}));

vi.mock("@/features/boss/boss-account-repository", () => ({
  DrizzleBossAccountRepository: class {},
}));
vi.mock("@/features/boss/boss-middleware", () => ({
  createRequireBossMiddleware: () => (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as express.Request & { bossAccount: object }).bossAccount = {};
    next();
  },
}));
vi.mock("@/features/routes/travel-leg-repository", () => ({
  DrizzleTravelLegRepository: class {
    listTravelLegs = mocks.listTravelLegs;
    listMapEvents = mocks.listMapEvents;
  },
}));
vi.mock("@/features/routes/location-resolver", () => ({
  resolveRouteMapEvents: mocks.resolveRouteMapEvents,
}));
vi.mock("@/features/trips/geocoding", () => ({
  NominatimGeocodingProvider: class {},
}));
vi.mock("@/features/calendar/schedule-display-settings", () => ({
  DrizzleScheduleDisplaySettingsRepository: class {
    get = vi.fn(async () => ({ eventColor: "#fb7185", travelColor: "#94a3b8" }));
  },
}));
vi.mock("@/features/leg-assignment/leg-assignment-repository", () => ({
  LegAssignmentRepository: class {},
}));
vi.mock("@/features/leg-assignment/leg-assignment-service", () => ({
  LegAssignmentService: class {},
}));
vi.mock("@/features/leg-assignment/drive-time-estimator", () => ({
  RouteDriveTimeEstimator: class {},
}));

import router from "./boss-operations";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTravelLegs.mockResolvedValue(legs);
  mocks.listMapEvents.mockResolvedValue(rawEvents);
  mocks.resolveRouteMapEvents.mockResolvedValue(resolvedEvents);
});

describe("Boss schedule route parity", () => {
  it("returns the same resolved multi-leg marker data used by the Admin route map", async () => {
    const response = await request(app()).get("/boss/legs");

    expect(response.status).toBe(200);
    expect(response.body.bookings).toHaveLength(2);
    expect(response.body.bookings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "booking-kristy",
        latitude: 44.2633,
        longitude: -104.9505,
        mappingState: "mapped_city",
        travelLegName: "Kristy",
      }),
      expect.objectContaining({
        id: "booking-hulk",
        latitude: 42.576,
        longitude: -111.729,
        mappingState: "mapped_city",
        travelLegName: "Hulk",
      }),
    ]));
  });
});
