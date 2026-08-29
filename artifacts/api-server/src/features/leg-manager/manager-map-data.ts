import type { ManagerMapBookingRecord } from "@/features/leg-manager/manager-map-booking-repository";
import type { TripSegmentRecord, TripStopRecord } from "@/features/trips/trip-repository";
import type { EquipmentHandoff, HandoffRepository, HandoffStatus, MeetupParticipant } from "@/features/routes/handoff-repository";

export type ManagerMapTrip = {
  id: string;
  travelLegId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  startLabel: string;
  startLatitude: number | null;
  startLongitude: number | null;
  endLabel: string;
  endLatitude: number | null;
  endLongitude: number | null;
  legName?: string;
  legColor?: string | null;
};

export interface ManagerMapTripRepository {
  listTrips(options: { travelLegId: string }): Promise<ManagerMapTrip[]>;
  listStops(tripId: string): Promise<TripStopRecord[]>;
  listSegments(tripId: string): Promise<TripSegmentRecord[]>;
}

export interface ManagerMapBookingRepository {
  listForLeg(legId: string): Promise<ManagerMapBookingRecord[]>;
}

export interface ManagerMapHandoffRepository {
  listForLeg(legId: string, options?: { approvedOnly?: boolean }): Promise<EquipmentHandoff[]>;
}

export type ManagerScheduleState = "booked" | "potential" | "excluded";

export type ManagerScheduleEvent = {
  bookingId: string;
  bookingName: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
    status: string;
    probability: string | null;
    scheduleState: ManagerScheduleState;
};

export interface ManagerScheduleTripRepository {
  listTrips(options: { travelLegId: string }): Promise<ManagerMapTrip[]>;
  listStops(tripId: string): Promise<TripStopRecord[]>;
  listSegments(tripId: string): Promise<TripSegmentRecord[]>;
}

export type ManagerScopedScheduleData = {
  leg: { id: string; name: string; color: string | null };
  trips: ManagerMapTrip[];
  route: ManagerScopedMapData["route"];
  events: ManagerScheduleEvent[];
};

export type ManagerScopedMapData = {
  leg: { id: string; name: string; color: string | null };
  route: null | {
    trip: {
      id: string;
      name: string;
      startLabel: string;
      startLatitude: number | null;
      startLongitude: number | null;
      endLabel: string;
      endLatitude: number | null;
      endLongitude: number | null;
    };
    stops: Array<{
      id: string;
      bookingId: string;
      bookingName: string;
      city: string;
      region: string;
      latitude: number | null;
      longitude: number | null;
      sortOrder: number;
      startsAt: Date | null;
      endsAt: Date | null;
      status: string;
      probability: string | null;
      scheduleState: ManagerScheduleState;
    }>;
    segments: Array<{
      id: string;
      fromLabel: string;
      toLabel: string;
      effectiveMiles: number | null;
      effectiveMinutes: number | null;
    }>;
  };
  events: Array<{
    bookingId: string;
    bookingName: string;
    city: string;
    region: string;
    latitude: number | null;
    longitude: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
       status: string;
       probability: string | null;
       scheduleState: ManagerScheduleState;
  }>;
  meetups: Array<{
    id: string;
    status: HandoffStatus;
    resourceName: string | null;
    meetupLabel: string;
    meetupLatitude: number;
    meetupLongitude: number;
    windowStartsAt: Date;
    windowEndsAt: Date;
    counterpart: MeetupParticipant;
  }>;
};

function ownsLeg(participant: MeetupParticipant, legId: string): boolean {
  return participant.kind === "leg" && participant.legId === legId;
}

function counterpartFor(handoff: EquipmentHandoff, legId: string): MeetupParticipant | null {
  if (ownsLeg(handoff.fromParticipant, legId)) return handoff.toParticipant;
  if (ownsLeg(handoff.toParticipant, legId)) return handoff.fromParticipant;
  return null;
}

export function managerScheduleState(
  status: string | null | undefined,
  probability: string | null | undefined,
): ManagerScheduleState {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const normalizedProbability = String(probability ?? "").trim().toLowerCase();
  if (["declined", "cancelled"].includes(normalizedStatus)) return "excluded";
  if (
    ["contract_received", "confirmed", "completed"].includes(normalizedStatus)
    || normalizedProbability === "definite"
  ) return "booked";
  return "potential";
}

function isVisibleScheduleEvent(
  event: Pick<ManagerScheduleEvent, "status" | "probability" | "startsAt" | "endsAt">,
  now: Date,
) {
  if (managerScheduleState(event.status, event.probability) !== "booked") return false;
  if (["declined", "cancelled", "completed"].includes(String(event.status).trim().toLowerCase())) return false;
  const relevantAt = event.endsAt ?? event.startsAt;
  return relevantAt === null || relevantAt.getTime() >= now.getTime() - 86_400_000;
}

function compareScheduleEvents(
  a: Pick<ManagerScheduleEvent, "bookingId" | "startsAt" | "endsAt">,
  b: Pick<ManagerScheduleEvent, "bookingId" | "startsAt" | "endsAt">,
) {
  const aTime = (a.startsAt ?? a.endsAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = (b.startsAt ?? b.endsAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  return aTime - bTime
    || (a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY)
    || a.bookingId.localeCompare(b.bookingId);
}

function eventFromStop(stop: TripStopRecord): ManagerScheduleEvent {
  return {
    bookingId: stop.bookingId,
    bookingName: stop.bookingName,
    city: stop.city,
    region: stop.region,
    latitude: stop.latitude,
    longitude: stop.longitude,
    startsAt: stop.startsAt,
    endsAt: stop.endsAt,
    status: stop.status,
    probability: stop.probability,
    scheduleState: managerScheduleState(stop.status, stop.probability),
  };
}

function eventFromBooking(booking: ManagerMapBookingRecord): ManagerScheduleEvent {
  return {
    bookingId: booking.bookingId,
    bookingName: booking.bookingName,
    city: booking.city,
    region: booking.region,
    latitude: booking.latitude,
    longitude: booking.longitude,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    status: booking.status,
    probability: booking.probability,
    scheduleState: managerScheduleState(booking.status, booking.probability),
  };
}

export async function loadManagerScopedScheduleData(
  dependencies: {
    tripRepository: ManagerScheduleTripRepository;
    bookingRepository: ManagerMapBookingRepository;
  },
  legId: string,
  now = new Date(),
): Promise<ManagerScopedScheduleData> {
  const [listedTrips, listedBookings] = await Promise.all([
    dependencies.tripRepository.listTrips({ travelLegId: legId }),
    dependencies.bookingRepository.listForLeg(legId),
  ]);

  const allTrips = listedTrips
    .filter((trip) => trip.travelLegId === legId)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || a.id.localeCompare(b.id));
  const assignedBookings = listedBookings
    .map(eventFromBooking)
    .filter((event) => isVisibleScheduleEvent(event, now));

  const activeTrips = allTrips.filter((trip) => trip.endDate.getTime() >= now.getTime() - 86_400_000);
  const details = await Promise.all(
    activeTrips.map(async (trip) => ({
      trip,
      stops: await dependencies.tripRepository.listStops(trip.id),
      segments: await dependencies.tripRepository.listSegments(trip.id),
    })),
  );

  const current = details.find(({ trip }) => trip.startDate <= now && trip.endDate >= now) ?? details[0] ?? null;
  const eventsByBookingId = new Map<string, ManagerScheduleEvent>();
  for (const booking of assignedBookings) {
    eventsByBookingId.set(booking.bookingId, booking);
  }
  for (const event of details.flatMap(({ stops }) => stops.map(eventFromStop))) {
    if (isVisibleScheduleEvent(event, now) && !eventsByBookingId.has(event.bookingId)) {
      eventsByBookingId.set(event.bookingId, event);
    }
  }
  const events = [...eventsByBookingId.values()].sort(compareScheduleEvents);

  const firstTrip = allTrips[0];
  const firstAssignedBooking = listedBookings[0];
  const route = current
    ? {
        trip: {
          id: current.trip.id,
          name: current.trip.name,
          startLabel: current.trip.startLabel,
          startLatitude: current.trip.startLatitude,
          startLongitude: current.trip.startLongitude,
          endLabel: current.trip.endLabel,
          endLatitude: current.trip.endLatitude,
          endLongitude: current.trip.endLongitude,
        },
        stops: current.stops
          .filter((stop) => isVisibleScheduleEvent(stop, now))
          .sort((a, b) => a.sortOrder - b.sortOrder || compareScheduleEvents(eventFromStop(a), eventFromStop(b)))
          .map((stop) => ({
          id: stop.id,
          bookingId: stop.bookingId,
          bookingName: stop.bookingName,
          city: stop.city,
          region: stop.region,
          latitude: stop.latitude,
          longitude: stop.longitude,
          sortOrder: stop.sortOrder,
          startsAt: stop.startsAt,
          endsAt: stop.endsAt,
          status: stop.status,
          probability: stop.probability,
          scheduleState: managerScheduleState(stop.status, stop.probability),
          })),
        segments: current.segments.map((segment) => ({
          id: segment.id,
          fromLabel: segment.fromLabel,
          toLabel: segment.toLabel,
          effectiveMiles: segment.overrideMiles ?? segment.miles,
          effectiveMinutes: segment.overrideMinutes ?? segment.minutes,
        })),
      }
    : null;

  return {
    leg: {
      id: legId,
      name: firstTrip?.legName ?? firstAssignedBooking?.legName ?? "Your leg",
      color: firstTrip?.legColor ?? firstAssignedBooking?.legColor ?? null,
    },
    trips: allTrips,
    route,
    events,
  };
}

export async function loadManagerScopedMapData(
  dependencies: {
    tripRepository: ManagerMapTripRepository;
    bookingRepository: ManagerMapBookingRepository;
    handoffRepository: ManagerMapHandoffRepository;
  },
  legId: string,
  now = new Date(),
): Promise<ManagerScopedMapData> {
  const schedule = await loadManagerScopedScheduleData(dependencies, legId, now);
  const rawMeetups = await dependencies.handoffRepository.listForLeg(legId, { approvedOnly: true });
  const meetups = rawMeetups.flatMap((handoff) => {
    const counterpart = counterpartFor(handoff, legId);
    if (!counterpart) return [];
    return [{
      id: handoff.id,
      status: handoff.status,
      resourceName: handoff.resourceName,
      meetupLabel: handoff.meetupLabel,
      meetupLatitude: handoff.meetupLatitude,
      meetupLongitude: handoff.meetupLongitude,
      windowStartsAt: handoff.windowStartsAt,
      windowEndsAt: handoff.windowEndsAt,
      counterpart,
    }];
  });

  return {
    leg: schedule.leg,
    route: schedule.route,
    events: schedule.events,
    meetups,
  };
}

export type { HandoffRepository };
