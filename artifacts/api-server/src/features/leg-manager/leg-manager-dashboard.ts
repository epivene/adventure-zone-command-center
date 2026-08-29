import type { TripSegmentRecord, TripStopRecord } from "@/features/trips/trip-repository";
import type { EventReviewStore } from "./event-review-repository";
import { listDueReviewsForManager } from "./event-review-repository";
import type { EventLifecycleRepository } from "./event-lifecycle-repository";
import {
  loadManagerScopedScheduleData,
  type ManagerMapBookingRepository,
  type ManagerMapTripRepository,
  type ManagerScopedScheduleData,
} from "./manager-map-data";

export type ManagerTrip = {
  id: string;
  travelLegId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  startLabel: string;
  endLabel: string;
};

type LegacyTripStop = Omit<TripStopRecord, "probability"> & { probability?: string | null };

export interface LegManagerDashboardRepository {
  listTrips(o: { travelLegId: string }): Promise<ManagerTrip[]>;
  listStops(id: string): Promise<LegacyTripStop[]>;
  listSegments(id: string): Promise<TripSegmentRecord[]>;
}

export interface LegManagerDashboardDependencies {
  tripRepository: ManagerMapTripRepository;
  bookingRepository: ManagerMapBookingRepository;
  lifecycleRepository: Pick<EventLifecycleRepository, "getCurrentForLeg" | "listIncompleteForLeg">;
  reviewRepository: EventReviewStore;
  financeRepository: { summary(legId: string): Promise<Record<string, unknown>> };
}

type DashboardPartialError = { section: string; message: string };
type DashboardLifecycle = { bookingId: string; [key: string]: unknown };

export type LegManagerDashboard = ManagerScopedScheduleData & {
  legId: string;
  nextEvent: ManagerScopedScheduleData["events"][number] | null;
  currentLifecycle: DashboardLifecycle | null;
  lifecycle: DashboardLifecycle | null;
  incompleteWrapUps: unknown[];
  wrapUps: unknown[];
  reviewsDue: unknown[];
  reviews: unknown[];
  money: Record<string, unknown>;
  moneySummary: Record<string, unknown>;
  summary: {
    upcomingBookedEventsCount: number;
    incompleteWrapUpsCount: number;
    reviewsDueCount: number;
  };
  partialErrors: DashboardPartialError[];
};

type LegacyLegManagerDashboard = {
  legId: string;
  trips: ManagerScopedScheduleData["trips"];
  route: ManagerScopedScheduleData["route"];
  events: ManagerScopedScheduleData["events"];
  nextEvent: ManagerScopedScheduleData["events"][number] | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load this section";
}

function legacyScheduleRepository(repo: LegManagerDashboardRepository): ManagerMapTripRepository {
  return {
    async listTrips(options) {
      return (await repo.listTrips(options)).map((trip) => ({
        ...trip,
        startLatitude: null,
        startLongitude: null,
        endLatitude: null,
        endLongitude: null,
        vehicleName: null,
        mpg: null,
        fuelPricePerGallon: null,
        routeConfirmedAt: null,
        notes: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        legName: "",
        legColor: null,
        stopCount: 0,
      }));
    },
    async listStops(tripId) {
      return (await repo.listStops(tripId)).map((stop) => ({ ...stop, probability: stop.probability ?? null }));
    },
    listSegments: (tripId) => repo.listSegments(tripId),
  };
}

function legacyScheduleData(repo: LegManagerDashboardRepository, legId: string, now: Date) {
  return loadManagerScopedScheduleData({
    tripRepository: legacyScheduleRepository(repo),
    bookingRepository: { listForLeg: async () => [] },
  }, legId, now);
}

export function loadLegManagerDashboard(
  input: LegManagerDashboardDependencies,
  legId: string,
  now?: Date,
): Promise<LegManagerDashboard>;
export function loadLegManagerDashboard(
  input: LegManagerDashboardRepository,
  legId: string,
  now?: Date,
): Promise<LegacyLegManagerDashboard>;
export async function loadLegManagerDashboard(
  input: LegManagerDashboardDependencies | LegManagerDashboardRepository,
  legId: string,
  now = new Date(),
): Promise<LegManagerDashboard | LegacyLegManagerDashboard> {
  const isAggregate = "tripRepository" in input;
  const schedule = isAggregate
    ? loadManagerScopedScheduleData(input, legId, now)
    : legacyScheduleData(input, legId, now);

  if (!isAggregate) {
    const data = await schedule;
    const current = data.route ? { trip: data.route.trip, stops: data.route.stops, segments: data.route.segments } : null;
    const nextEvent = data.events.find((event) => (event.endsAt ?? event.startsAt ?? new Date(0)).getTime() >= now.getTime()) ?? null;
    return { legId, trips: data.trips, route: current, events: data.events, nextEvent };
  }

  const partialErrors: DashboardPartialError[] = [];
  const [scheduleResult, currentResult, wrapUpsResult, reviewsResult, moneyResult] = await Promise.allSettled([
    schedule,
    input.lifecycleRepository.getCurrentForLeg(legId),
    input.lifecycleRepository.listIncompleteForLeg(legId),
    listDueReviewsForManager(input.reviewRepository, legId, now),
    input.financeRepository.summary(legId),
  ]);

  if (scheduleResult.status === "rejected") {
    throw scheduleResult.reason;
  }
  const scheduleData: ManagerScopedScheduleData = scheduleResult.value;
  const currentLifecycle = currentResult.status === "fulfilled"
    ? currentResult.value as DashboardLifecycle
    : null;
  const incompleteWrapUps = wrapUpsResult.status === "fulfilled" ? wrapUpsResult.value : [];
  const reviewsDue = reviewsResult.status === "fulfilled" ? reviewsResult.value : [];
  const money = moneyResult.status === "fulfilled" ? moneyResult.value : {};

  if (currentResult.status === "rejected") partialErrors.push({ section: "currentLifecycle", message: errorMessage(currentResult.reason) });
  if (wrapUpsResult.status === "rejected") partialErrors.push({ section: "wrapUps", message: errorMessage(wrapUpsResult.reason) });
  if (reviewsResult.status === "rejected") partialErrors.push({ section: "reviews", message: errorMessage(reviewsResult.reason) });
  if (moneyResult.status === "rejected") partialErrors.push({ section: "money", message: errorMessage(moneyResult.reason) });

  return {
    legId,
    ...scheduleData,
    nextEvent: scheduleData.events.find((event) => (event.endsAt ?? event.startsAt ?? new Date(0)).getTime() >= now.getTime()) ?? null,
    currentLifecycle,
    lifecycle: currentLifecycle,
    incompleteWrapUps,
    wrapUps: incompleteWrapUps,
    reviewsDue,
    reviews: reviewsDue,
    money,
    moneySummary: money,
    summary: {
      upcomingBookedEventsCount: scheduleData.events.length,
      incompleteWrapUpsCount: incompleteWrapUps.length,
      reviewsDueCount: reviewsDue.length,
    },
    partialErrors,
  };
}
