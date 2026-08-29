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

function eventFromStop(stop: TripStopRecord): ManagerScopedMapData["events"][number] {
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
  };
}

function eventFromBooking(booking: ManagerMapBookingRecord): ManagerScopedMapData["events"][number] {
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
  };
}

function isCurrentOrUpcomingBooking(booking: ManagerMapBookingRecord, now: Date): boolean {
  if (["declined", "cancelled", "completed"].includes(booking.status)) return false;
  const relevantAt = booking.endsAt ?? booking.startsAt;
  return relevantAt === null || relevantAt.getTime() >= now.getTime() - 86_400_000;
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
  const [listedTrips, listedBookings] = await Promise.all([
    dependencies.tripRepository.listTrips({ travelLegId: legId }),
    dependencies.bookingRepository.listForLeg(legId),
  ]);

  const allTrips = listedTrips
    .filter((trip) => trip.travelLegId === legId)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const assignedBookings = listedBookings.filter((booking) => isCurrentOrUpcomingBooking(booking, now));

  const activeTrips = allTrips.filter((trip) => trip.endDate.getTime() >= now.getTime() - 86_400_000);
  const details = await Promise.all(
    activeTrips.map(async (trip) => ({
      trip,
      stops: await dependencies.tripRepository.listStops(trip.id),
      segments: await dependencies.tripRepository.listSegments(trip.id),
    })),
  );

  const current = details.find(({ trip }) => trip.startDate <= now && trip.endDate >= now) ?? details[0] ?? null;
  const eventsByBookingId = new Map<string, ManagerScopedMapData["events"][number]>();
  for (const booking of assignedBookings) {
    eventsByBookingId.set(booking.bookingId, eventFromBooking(booking));
  }
  for (const event of details.flatMap(({ stops }) => stops.map(eventFromStop))) {
    if (!eventsByBookingId.has(event.bookingId)) eventsByBookingId.set(event.bookingId, event);
  }
  const events = [...eventsByBookingId.values()]
    .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0));

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

  const firstTrip = allTrips[0];
  const firstAssignedBooking = assignedBookings[0];
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
        stops: current.stops.map((stop) => ({
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
          probability: stop.probability,
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
    route,
    events,
    meetups,
  };
}

export type { HandoffRepository };
