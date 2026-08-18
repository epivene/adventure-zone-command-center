import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import { PackageHistoryRepository } from "@/features/packages/package-history";

import { buildBookingContextBundle } from "./booking-context-builder";
import { PostgresBusinessKnowledgeRepository } from "./business-knowledge-repository";
import type { BookingAssistantContextBundle } from "./assistant-types";

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function displayName(row: any): string {
  const full = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return full || row.name || "Unnamed contact";
}

export class BookingContextRepository {
  private readonly knowledge: PostgresBusinessKnowledgeRepository;

  constructor(private readonly pool: Pool = defaultPool) {
    this.knowledge = new PostgresBusinessKnowledgeRepository(pool);
  }

  async getBookingContext(
    bookingId: string,
  ): Promise<BookingAssistantContextBundle | null> {
    const bookingResult = await this.pool.query(
      `SELECT b.id, b.name, b.starts_at, b.ends_at, b.venue_name, b.city, b.region,
              b.status, b.physical_attraction_total,
              b.organization_id, b.travel_leg_id,
              o.name AS organization_name
       FROM bookings b
       LEFT JOIN organizations o ON o.id = b.organization_id
       WHERE b.id = $1`,
      [bookingId],
    );
    const booking = bookingResult.rows[0];
    if (!booking) return null;

    const contactsResult = await this.pool.query(
      `SELECT c.id, c.first_name, c.last_name, bc.is_primary
       FROM booking_contacts bc
       JOIN contacts c ON c.id = bc.contact_id
       WHERE bc.booking_id = $1
       ORDER BY bc.is_primary DESC, c.last_name, c.first_name, c.id
       LIMIT 12`,
      [bookingId],
    );
    const contacts = contactsResult.rows.map((row) => ({
      id: row.id as string,
      label: displayName(row),
      isPrimary: Boolean(row.is_primary),
    }));

    const eventFamilyResult = booking.organization_id
      ? await this.pool.query(
          `SELECT family_id
           FROM event_family_members
           WHERE organization_id = $1
           LIMIT 1`,
          [booking.organization_id],
        )
      : { rows: [] as any[] };
    const eventFamilyId = eventFamilyResult.rows[0]?.family_id ?? null;

    const relatedBookingResult = eventFamilyId
      ? await this.pool.query(
          `SELECT b.id, b.name, b.starts_at, b.ends_at, b.venue_name, b.city, b.region,
                  b.status, b.physical_attraction_total
           FROM bookings b
           JOIN event_family_members efm ON efm.organization_id = b.organization_id
           WHERE efm.family_id = $1
             AND b.id <> $2
             AND b.status NOT IN ('cancelled','declined')
           ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
           LIMIT 8`,
          [eventFamilyId, bookingId],
        )
      : booking.organization_id
        ? await this.pool.query(
            `SELECT id, name, starts_at, ends_at, venue_name, city, region,
                    status, physical_attraction_total
             FROM bookings
             WHERE organization_id = $1
               AND id <> $2
               AND status NOT IN ('cancelled','declined')
             ORDER BY starts_at DESC NULLS LAST, created_at DESC
             LIMIT 8`,
            [booking.organization_id, bookingId],
          )
        : { rows: [] as any[] };

    const relatedBookingIds = [
      bookingId,
      ...relatedBookingResult.rows.map((row) => row.id as string),
    ];
    const [packageRows, resourceRows] = await Promise.all([
      this.pool.query(
        `SELECT bps.booking_id, pt.id AS package_id, pt.name
         FROM booking_package_selections bps
         JOIN package_templates pt ON pt.id = bps.package_template_id
         WHERE bps.booking_id = ANY($1::uuid[])
         ORDER BY pt.name`,
        [relatedBookingIds],
      ),
      this.pool.query(
        `SELECT bra.booking_id, r.id AS resource_id, r.name, r.package_count_category
         FROM booking_resource_assignments bra
         JOIN resources r ON r.id = bra.resource_id
         WHERE bra.booking_id = ANY($1::uuid[])
         ORDER BY r.name`,
        [relatedBookingIds],
      ),
    ]);

    const bookingSummary = (row: any) => ({
      id: row.id as string,
      label: row.name as string,
      startsAt: dateOrNull(row.starts_at),
      endsAt: dateOrNull(row.ends_at),
      venueName: row.venue_name ? String(row.venue_name) : null,
      city: row.city ? String(row.city) : null,
      region: row.region ? String(row.region) : null,
      status: row.status as string,
      physicalAttractionTotal:
        row.physical_attraction_total === null
          ? null
          : Number(row.physical_attraction_total),
      packageNames: packageRows.rows
        .filter((pkg) => pkg.booking_id === row.id)
        .map((pkg) => pkg.name as string),
      specialResourceNames: resourceRows.rows
        .filter(
          (resource) =>
            resource.booking_id === row.id &&
            resource.package_count_category === "special_shared",
        )
        .map((resource) => resource.name as string),
    });

    const currentPackageIds = packageRows.rows
      .filter((row) => row.booking_id === bookingId)
      .map((row) => row.package_id as string);
    const currentResourceIds = resourceRows.rows
      .filter((row) => row.booking_id === bookingId)
      .map((row) => row.resource_id as string);

    const activityParams: unknown[] = [bookingId];
    let activityWhere = "a.booking_id = $1";
    if (booking.organization_id) {
      activityParams.push(booking.organization_id);
      activityWhere = `(a.booking_id = $1 OR a.organization_id = $2)`;
    }
    const activitiesResult = await this.pool.query(
      `SELECT a.id, a.kind, a.body,
              COALESCE(a.occurred_at, a.timeline_sort_at, a.created_at) AS occurred_at
       FROM activities a
       WHERE ${activityWhere}
         AND a.deleted_at IS NULL
       ORDER BY COALESCE(a.occurred_at, a.timeline_sort_at, a.created_at) DESC,
                a.created_at DESC
       LIMIT 25`,
      activityParams,
    );

    const followUpsResult = await this.pool.query(
      `SELECT id, kind, due_at
       FROM follow_ups
       WHERE booking_id = $1
         AND completed_at IS NULL
       ORDER BY due_at, id
       LIMIT 12`,
      [bookingId],
    );

    const routeResult = booking.travel_leg_id
      ? await this.pool.query(
          `SELECT id, name
           FROM travel_legs
           WHERE id = $1
           LIMIT 1`,
          [booking.travel_leg_id],
        )
      : { rows: [] as any[] };
    const route = routeResult.rows[0];

    const contactIds = contacts.map((contact) => contact.id);
    const derivedParams: unknown[] = [bookingId];
    const derivedClauses = ["booking_id = $1"];
    if (booking.organization_id) {
      derivedParams.push(booking.organization_id);
      derivedClauses.push(`organization_id = $${derivedParams.length}`);
    }
    if (contactIds.length > 0) {
      derivedParams.push(contactIds);
      derivedClauses.push(`contact_id = ANY($${derivedParams.length}::uuid[])`);
    }
    const derivedResult = await this.pool.query(
      `SELECT id, fact_kind, summary, confidence, status, source_activity_id
       FROM derived_crm_facts
       WHERE (${derivedClauses.join(" OR ")})
         AND status <> 'dismissed'
       ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END,
                updated_at DESC
       LIMIT 30`,
      derivedParams,
    );

    const [packageHistory, knowledge] = await Promise.all([
      new PackageHistoryRepository(this.pool).compareBooking(bookingId),
      this.knowledge.listActiveForContext({
        packageTemplateIds: currentPackageIds,
        resourceIds: currentResourceIds,
        includeGlobal: true,
      }),
    ]);

    return buildBookingContextBundle({
      context: {
        kind: "booking",
        recordId: bookingId,
        label: booking.name,
      },
      profile: {
        organizationId: booking.organization_id ?? null,
        eventFamilyId,
        contacts,
      },
      currentBooking: bookingSummary(booking),
      priorBookings: relatedBookingResult.rows.map(bookingSummary),
      recentActivities: activitiesResult.rows.map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        summary: String(row.body ?? "").trim().slice(0, 600),
        occurredAt: dateOrNull(row.occurred_at),
      })),
      openFollowUps: followUpsResult.rows.map((row) => ({
        id: row.id as string,
        kind: row.kind as string,
        dueAt: new Date(row.due_at),
        label: `${String(row.kind).replaceAll("_", " ")} follow-up`,
      })),
      packageHistorySignals: packageHistory?.signals ?? [],
      routeContext: route
        ? {
            id: route.id as string,
            label: route.name as string,
            summary: `This booking is assigned to ${route.name}.`,
          }
        : null,
      derivedFacts: derivedResult.rows.map((row) => ({
        id: row.id as string,
        factKind: row.fact_kind as string,
        summary: row.summary as string,
        confidence: row.confidence as "high" | "medium" | "low",
        status: row.status as "proposed" | "confirmed" | "dismissed",
        sourceActivityIds: row.source_activity_id
          ? [row.source_activity_id as string]
          : [],
      })),
      businessKnowledge: knowledge.map((entry) => ({
        id: entry.id,
        title: entry.title,
        body: entry.body,
      })),
      generatedAt: new Date(),
    });
  }
}
