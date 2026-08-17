import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import { buildBookingContextBundle } from "./booking-context-builder";
import { BookingContextRepository } from "./booking-context-repository";
import { PostgresBusinessKnowledgeRepository } from "./business-knowledge-repository";
import type { BookingAssistantContextBundle } from "./assistant-types";

export class RouteContextRepository {
  private readonly bookingContext: BookingContextRepository;
  private readonly knowledge: PostgresBusinessKnowledgeRepository;

  constructor(private readonly pool: Pool = defaultPool) {
    this.bookingContext = new BookingContextRepository(pool);
    this.knowledge = new PostgresBusinessKnowledgeRepository(pool);
  }

  async getRouteContext(tripId: string): Promise<BookingAssistantContextBundle | null> {
    const tripResult = await this.pool.query(
      `SELECT t.id, t.name, t.travel_leg_id, t.start_date, t.end_date, l.name AS leg_name
       FROM trips t
       JOIN travel_legs l ON l.id = t.travel_leg_id
       WHERE t.id = $1`,
      [tripId],
    );
    const trip = tripResult.rows[0];
    if (!trip) return null;

    const stopsResult = await this.pool.query(
      `SELECT ts.booking_id
       FROM trip_stops ts
       JOIN bookings b ON b.id = ts.booking_id
       WHERE ts.trip_id = $1
       ORDER BY
         CASE WHEN b.starts_at >= now() THEN 0 ELSE 1 END,
         b.starts_at ASC NULLS LAST,
         ts.sort_order ASC
       LIMIT 1`,
      [tripId],
    );
    const bookingId = stopsResult.rows[0]?.booking_id as string | undefined;
    if (bookingId) {
      const bundle = await this.bookingContext.getBookingContext(bookingId);
      if (bundle) {
        return {
          ...bundle,
          context: { kind: "route", recordId: tripId, label: trip.name },
          routeContext: {
            id: tripId,
            label: `${trip.name} · ${trip.leg_name}`,
            travelLegId: trip.travel_leg_id,
          },
        };
      }
    }

    const knowledge = await this.knowledge.listActiveForContext({
      packageTemplateIds: [],
      resourceIds: [],
      includeGlobal: true,
    });
    return buildBookingContextBundle({
      context: { kind: "route", recordId: tripId, label: trip.name },
      profile: { organizationId: null, eventFamilyId: null, contacts: [] },
      currentBooking: null,
      priorBookings: [],
      recentActivities: [],
      openFollowUps: [],
      packageHistorySignals: [],
      routeContext: {
        id: tripId,
        label: `${trip.name} · ${trip.leg_name}`,
        travelLegId: trip.travel_leg_id,
      },
      derivedFacts: [],
      businessKnowledge: knowledge.map((entry) => ({
        id: entry.id,
        title: entry.title,
        body: entry.body,
      })),
      generatedAt: new Date(),
    });
  }
}
