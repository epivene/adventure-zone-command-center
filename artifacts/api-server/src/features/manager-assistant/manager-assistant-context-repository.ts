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

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
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
              COALESCE(array_agg(DISTINCT pt.name) FILTER (WHERE pt.name IS NOT NULL), '{}') AS package_names,
              COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS resource_names,
              b.notes
       FROM bookings b
       LEFT JOIN booking_package_selections bps ON bps.booking_id = b.id
       LEFT JOIN package_templates pt ON pt.id = bps.package_template_id
       LEFT JOIN booking_resource_assignments bra ON bra.booking_id = b.id
       LEFT JOIN resources r ON r.id = bra.resource_id
       WHERE b.id = ANY($1::uuid[]) AND b.travel_leg_id = $2
       GROUP BY b.id, b.notes`,
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
        status: event.status,
        packageNames: (extra?.package_names ?? []) as string[],
        resourceNames: (extra?.resource_names ?? []) as string[],
        setupSummary: typeof extra?.notes === "string" && extra.notes.trim()
          ? extra.notes.trim().slice(0, 1000)
          : null,
      };
    });
  }

  async getRoute(legId: string): Promise<ManagerRouteAssistantSummary | null> {
    const map = await this.scopedMap(legId);
    if (!map.route) return null;
    return {
      tripId: map.route.trip.id,
      label: map.route.trip.name,
      startDate: null,
      endDate: null,
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
      summary: `${row.title}${row.managerComment ? ` — ${row.managerComment}` : ""}`,
    }));
  }

  async listOperationalInstructions(legId: string) {
    const events = await this.listAssignedEvents(legId);
    return events
      .filter((event) => event.setupSummary)
      .map((event) => ({
        id: `booking:${event.id}`,
        summary: `${event.name}: ${event.setupSummary}`,
      }));
  }

  async listKnowledge(input: {
    legId: string;
    bookingId: string | null;
    tripId: string | null;
  }) {
    const result = await this.pool.query(
      `SELECT id, title, body
       FROM operations_knowledge_entries
       WHERE active = true
         AND effective_at <= now()
         AND (review_after IS NULL OR review_after >= now())
         AND (
           scope = 'global'
           OR (scope = 'leg' AND scope_record_id = $1)
         )
       ORDER BY effective_at DESC, created_at DESC
       LIMIT 40`,
      [input.legId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      body: row.body as string,
    }));
  }
}
