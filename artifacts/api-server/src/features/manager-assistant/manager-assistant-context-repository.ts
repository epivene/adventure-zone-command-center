import type { Pool } from "pg";
import { db, pool as defaultPool } from "@workspace/db";

import { DrizzleManagerMapBookingRepository } from "@/features/leg-manager/manager-map-booking-repository";
import { loadManagerScopedMapData } from "@/features/leg-manager/manager-map-data";
import { AcknowledgmentRepository } from "@/features/manager-comms/acknowledgment-repository";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import type { ManagerAssistantContextSource } from "./manager-assistant-context";
import type {
  ManagerAssignedEventSummary,
  ManagerRouteAssistantSummary,
} from "./manager-assistant-types";

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresManagerAssistantContextSource
  implements ManagerAssistantContextSource
{
  private readonly acknowledgments = new AcknowledgmentRepository(db);
  private mapPromise: Promise<Awaited<ReturnType<typeof loadManagerScopedMapData>>> | null = null;
  private mapLegId: string | null = null;

  constructor(private readonly pool: Pool = defaultPool) {}

  private scopedMap(legId: string) {
    if (!this.mapPromise || this.mapLegId !== legId) {
      this.mapLegId = legId;
      this.mapPromise = loadManagerScopedMapData(
        {
          tripRepository: new DrizzleTripRepository(db),
          bookingRepository: new DrizzleManagerMapBookingRepository(db),
          handoffRepository: new HandoffRepository(db),
        },
        legId,
      );
    }
    return this.mapPromise;
  }

  async getLeg(legId: string) {
    const result = await this.pool.query(
      `SELECT id, name FROM travel_legs WHERE id = $1 AND archived_at IS NULL`,
      [legId],
    );
    const row = result.rows[0];
    return row ? { id: row.id as string, name: row.name as string } : null;
  }

  async listAssignedEvents(legId: string): Promise<ManagerAssignedEventSummary[]> {
    const map = await this.scopedMap(legId);
    if (map.events.length === 0) return [];
    const ids = map.events.map((event) => event.bookingId);
    const extras = await this.pool.query(
      `SELECT b.id,
              ell.checked_in_at,
              ell.checked_out_at,
              ell.check_in_time_zone,
              ell.check_out_time_zone,
              COALESCE(array_agg(DISTINCT pt.name) FILTER (WHERE pt.name IS NOT NULL), '{}') AS package_names,
              COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS resource_names
       FROM bookings b
       LEFT JOIN event_leg_lifecycle ell ON ell.booking_id = b.id AND ell.leg_id = b.travel_leg_id
       LEFT JOIN booking_package_selections bps ON bps.booking_id = b.id
       LEFT JOIN package_templates pt ON pt.id = bps.package_template_id
       LEFT JOIN booking_resource_assignments bra ON bra.booking_id = b.id
       LEFT JOIN resources r ON r.id = bra.resource_id
       WHERE b.id = ANY($1::uuid[]) AND b.travel_leg_id = $2
       GROUP BY b.id, ell.checked_in_at, ell.checked_out_at, ell.check_in_time_zone, ell.check_out_time_zone`,
      [ids, legId],
    );
    const byId = new Map(extras.rows.map((row) => [row.id as string, row]));
    return map.events.map((event) => {
      const extra = byId.get(event.bookingId);
      return {
        id: event.bookingId,
        name: event.bookingName,
        city: event.city,
        region: event.region,
        startsAt: iso(event.startsAt),
        endsAt: iso(event.endsAt),
        checkedInAt: iso(extra?.checked_in_at),
        checkedOutAt: iso(extra?.checked_out_at),
        checkInTimeZone: (extra?.check_in_time_zone as string | null | undefined) ?? null,
        checkOutTimeZone: (extra?.check_out_time_zone as string | null | undefined) ?? null,
        status: event.status,
        packageNames: (extra?.package_names ?? []) as string[],
        resourceNames: (extra?.resource_names ?? []) as string[],
        setupSummary: null,
      };
    });
  }

  async getRoute(legId: string): Promise<ManagerRouteAssistantSummary | null> {
    const map = await this.scopedMap(legId);
    if (!map.route || map.route.trip.navigationOnly) return null;
    const trip = await new DrizzleTripRepository(db).getTrip(map.route.trip.id);
    return {
      tripId: map.route.trip.id,
      label: map.route.trip.name,
      startDate: iso(trip?.startDate),
      endDate: iso(trip?.endDate),
      stops: map.route.stops.map((stop) => ({
        bookingId: stop.bookingId,
        label: stop.bookingName,
        sortOrder: stop.sortOrder,
      })),
    };
  }

  async listHandoffs(legId: string) {
    const map = await this.scopedMap(legId);
    return map.meetups.map((meetup) => ({
      id: meetup.id,
      summary: `${meetup.resourceName ?? "Equipment"} meetup at ${meetup.meetupLabel} between ${meetup.windowStartsAt.toISOString()} and ${meetup.windowEndsAt.toISOString()}.`,
    }));
  }

  async listAcknowledgments(legId: string) {
    const rows = await this.acknowledgments.listActiveForLeg(legId);
    return rows.map((row) => ({
      id: row.id,
      summary: row.title,
    }));
  }

  async listOperationalInstructions(_legId: string) {
    return [];
  }

  async listKnowledge(input: {
    legId: string;
    bookingId: string | null;
    tripId: string | null;
  }) {
    const result = await this.pool.query(
      `SELECT ok.id, ok.title, ok.body
       FROM operations_knowledge_entries ok
       WHERE ok.active = true
         AND ok.effective_at <= now()
         AND (ok.review_after IS NULL OR ok.review_after >= now())
         AND (
           ok.scope = 'global'
           OR (ok.scope = 'leg' AND ok.scope_record_id = $1)
           OR (
             $2::uuid IS NOT NULL
             AND ok.scope = 'package'
             AND ok.scope_record_id IN (
               SELECT bps.package_template_id::text
               FROM booking_package_selections bps
               WHERE bps.booking_id = $2::uuid
             )
           )
           OR (
             $2::uuid IS NOT NULL
             AND ok.scope = 'resource'
             AND ok.scope_record_id IN (
               SELECT bra.resource_id::text
               FROM booking_resource_assignments bra
               WHERE bra.booking_id = $2::uuid
             )
           )
           OR (
             $2::uuid IS NOT NULL
             AND ok.scope = 'site'
             AND ok.scope_record_id = (
               SELECT b.organization_location_id::text
               FROM bookings b
               WHERE b.id = $2::uuid AND b.travel_leg_id = $1::uuid
             )
           )
         )
       ORDER BY ok.effective_at DESC, ok.created_at DESC
       LIMIT 40`,
      [input.legId, input.bookingId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      body: row.body as string,
    }));
  }
}
