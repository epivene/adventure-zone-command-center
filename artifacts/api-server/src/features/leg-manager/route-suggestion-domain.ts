import { eq, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { bookings, tripStops, trips } from "@/db/schema";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { bookingEditInputSchema } from "@/features/bookings/booking-input";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import { HandoffService } from "@/features/routes/handoff-service";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import type { ManagerRouteSuggestion } from "./route-suggestion-repository";
import type { RouteSuggestionMutationAdapter, RouteSuggestionTargetResolver } from "./route-suggestion-service";

type DrizzleDatabase = typeof database;

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function tripStopTripId(target: { snapshot: unknown } | null) {
  const snapshot = target?.snapshot;
  if (!snapshot || typeof snapshot !== "object" || !("tripId" in snapshot)) return null;
  return typeof snapshot.tripId === "string" ? snapshot.tripId : null;
}

export class DrizzleRouteSuggestionDomain implements RouteSuggestionTargetResolver, RouteSuggestionMutationAdapter {
  private readonly tripRepository: DrizzleTripRepository;
  private readonly bookingRepository: DrizzleBookingRepository;
  private readonly handoffRepository: HandoffRepository;

  constructor(private readonly database: DrizzleDatabase) {
    this.tripRepository = new DrizzleTripRepository(database);
    this.bookingRepository = new DrizzleBookingRepository(database);
    this.handoffRepository = new HandoffRepository(database);
  }

  async resolve(targetType: ManagerRouteSuggestion["targetType"], targetId: string) {
    if (targetType === "trip") {
      const trip = await this.tripRepository.getTrip(targetId);
      if (!trip) return null;
      return {
        legIds: [trip.travelLegId],
        snapshot: {
          id: trip.id,
          travelLegId: trip.travelLegId,
          startDate: iso(trip.startDate),
          endDate: iso(trip.endDate),
          startLabel: trip.startLabel,
          endLabel: trip.endLabel,
        },
      };
    }

    if (targetType === "trip_stop") {
      const [row] = await this.database
        .select({ id: tripStops.id, tripId: tripStops.tripId, bookingId: tripStops.bookingId, sortOrder: tripStops.sortOrder, travelLegId: trips.travelLegId })
        .from(tripStops)
        .innerJoin(trips, eq(tripStops.tripId, trips.id))
        .where(eq(tripStops.id, targetId))
        .limit(1);
      if (!row) return null;
      return { legIds: [row.travelLegId], snapshot: row };
    }

    if (targetType === "booking") {
      const [row] = await this.database
        .select({ id: bookings.id, travelLegId: bookings.travelLegId, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
        .from(bookings)
        .where(eq(bookings.id, targetId))
        .limit(1);
      if (!row?.travelLegId) return null;
      return {
        legIds: [row.travelLegId],
        snapshot: { id: row.id, travelLegId: row.travelLegId, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt) },
      };
    }

    const handoff = await this.handoffRepository.get(targetId);
    if (!handoff) return null;
    const legIds = [handoff.fromParticipant, handoff.toParticipant]
      .filter((participant) => participant.kind === "leg")
      .map((participant) => participant.kind === "leg" ? participant.legId : "");
    return {
      legIds,
      snapshot: {
        id: handoff.id,
        status: handoff.status,
        meetupLabel: handoff.meetupLabel,
        meetupLatitude: handoff.meetupLatitude,
        meetupLongitude: handoff.meetupLongitude,
        windowStartsAt: iso(handoff.windowStartsAt),
        windowEndsAt: iso(handoff.windowEndsAt),
      },
    };
  }

  async apply(suggestion: ManagerRouteSuggestion): Promise<{ ok: true } | { ok: false; error: string }> {
    if (suggestion.targetType === "trip_stop" && suggestion.kind === "reorder_stop") {
      const target = await this.resolve("trip_stop", suggestion.targetId);
      const tripId = tripStopTripId(target);
      const requested = Number(suggestion.proposedJson.sortOrder);
      if (typeof tripId !== "string" || !Number.isInteger(requested) || requested < 1) return { ok: false, error: "Choose a valid stop position." };
      const stops = await this.tripRepository.listStops(tripId);
      const moving = stops.find((stop) => stop.id === suggestion.targetId);
      if (!moving) return { ok: false, error: "Trip stop no longer exists." };
      const ids = stops.filter((stop) => stop.id !== moving.id).map((stop) => stop.id);
      ids.splice(Math.min(ids.length, requested - 1), 0, moving.id);
      return (await this.tripRepository.setStopOrder(tripId, ids)) ? { ok: true } : { ok: false, error: "Trip stop order changed before approval." };
    }

    if (suggestion.targetType === "trip_stop" && suggestion.kind === "remove_stop") {
      const target = await this.resolve("trip_stop", suggestion.targetId);
      const tripId = tripStopTripId(target);
      if (typeof tripId !== "string") return { ok: false, error: "Trip stop no longer exists." };
      return (await this.tripRepository.removeStop(tripId, suggestion.targetId)) ? { ok: true } : { ok: false, error: "Trip stop no longer exists." };
    }

    if (suggestion.targetType === "booking" && suggestion.kind === "change_event_time") {
      const detail = await this.bookingRepository.getBookingDetail(suggestion.targetId);
      if (!detail) return { ok: false, error: "Event no longer exists." };
      const startsAt = suggestion.proposedJson.startsAt ?? detail.booking.startsAt;
      const endsAt = suggestion.proposedJson.endsAt ?? detail.booking.endsAt;
      const parsed = bookingEditInputSchema.safeParse({
        name: detail.booking.name,
        venueName: detail.booking.venueName,
        address1: detail.booking.address1,
        city: detail.booking.city,
        region: detail.booking.region,
        postalCode: detail.booking.postalCode,
        latitude: detail.booking.latitude,
        longitude: detail.booking.longitude,
        startsAt,
        endsAt,
        status: detail.booking.status,
        probability: detail.booking.probability,
        travelLegId: detail.booking.travelLegId,
        notes: detail.booking.notes,
      });
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid event time." };
      await this.bookingRepository.updateBookingDetails(suggestion.targetId, parsed.data as any);
      return { ok: true };
    }

    if (suggestion.targetType === "handoff" && suggestion.kind === "change_meetup_time_or_location") {
      const handoff = await this.handoffRepository.get(suggestion.targetId);
      if (!handoff) return { ok: false, error: "Meetup no longer exists." };
      const meetupLabel = String(suggestion.proposedJson.meetupLabel ?? handoff.meetupLabel).trim();
      const latitude = Number(suggestion.proposedJson.latitude ?? handoff.meetupLatitude);
      const longitude = Number(suggestion.proposedJson.longitude ?? handoff.meetupLongitude);
      const windowStartsAt = new Date(String(suggestion.proposedJson.windowStartsAt ?? handoff.windowStartsAt));
      const windowEndsAt = new Date(String(suggestion.proposedJson.windowEndsAt ?? handoff.windowEndsAt));
      if (!meetupLabel || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Number.isNaN(windowStartsAt.getTime()) || Number.isNaN(windowEndsAt.getTime()) || windowEndsAt < windowStartsAt) {
        return { ok: false, error: "Review the proposed meetup location and time." };
      }
      const preview = await new HandoffService(this.database).preview(suggestion.targetId, { meetupLabel, latitude, longitude, windowStartsAt, windowEndsAt });
      if (!preview || preview.band === "infeasible") return { ok: false, error: "That meetup change is not feasible." };
      await this.handoffRepository.ensureSchema();
      await this.database.execute(sql`
        update equipment_handoffs set
          meetup_label=${meetupLabel}, meetup_latitude=${latitude}, meetup_longitude=${longitude},
          window_starts_at=${windowStartsAt}, window_ends_at=${windowEndsAt},
          combined_detour_miles=${preview.addedDetourMiles}, available_buffer_minutes=${preview.availableBufferMinutes},
          opportunity_band=${preview.band}, explanation=${`Manager change approved. ${preview.reasons.join(" ")}`}, updated_at=now()
        where id=${suggestion.targetId}::uuid and status='approved'
      `);
      return { ok: true };
    }

    return { ok: false, error: "This suggestion type requires manual admin review." };
  }
}
