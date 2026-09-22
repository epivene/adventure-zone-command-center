import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import { buildBookingContextBundle } from "./booking-context-builder";
import { BookingContextRepository } from "./booking-context-repository";
import { PostgresBusinessKnowledgeRepository } from "./business-knowledge-repository";
import type { BookingAssistantContextBundle } from "./assistant-types";
import { resolveEffectiveEventDate } from "@/features/event-date-coverage/effective-event-date";
import type { EffectiveEventDate } from "@/features/event-date-coverage/event-date-types";

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function contactLabel(row: any): string {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unnamed contact";
}

export function eventDateAssistantKnowledge(date: EffectiveEventDate | null) {
  if (!date) return null;
  const label = `${date.displayStatus[0]!.toUpperCase()}${date.displayStatus.slice(1)}`;
  return {
    id: `effective-event-date:${date.sourceId}`,
    title: "Next event date",
    body: `${label}: ${date.startsOn}${date.endsOn ? ` through ${date.endsOn}` : ""}. ${label === "Expected" ? "This is a researched expectation, not a booking." : ""}`.trim(),
    sourceIds: [] as string[],
  };
}

export class ProfileContextRepository {
  private readonly bookingContext: BookingContextRepository;
  private readonly knowledge: PostgresBusinessKnowledgeRepository;

  constructor(private readonly pool: Pool = defaultPool) {
    this.bookingContext = new BookingContextRepository(pool);
    this.knowledge = new PostgresBusinessKnowledgeRepository(pool);
  }

  async getOrganizationContext(
    organizationId: string,
  ): Promise<BookingAssistantContextBundle | null> {
    const organizationResult = await this.pool.query(
      `SELECT id, name FROM organizations WHERE id = $1 AND consolidated_into_id IS NULL`,
      [organizationId],
    );
    const organization = organizationResult.rows[0];
    if (!organization) return null;

    const [dateBookings, dateFacts] = await Promise.all([
      this.pool.query(`SELECT id, starts_at, ends_at, status FROM bookings WHERE organization_id = $1`, [organizationId]),
      this.pool.query(`SELECT id, starts_on, ends_on, status, active FROM event_date_facts WHERE organization_id = $1`, [organizationId]),
    ]);
    const effectiveEventDate = resolveEffectiveEventDate({
      today: new Date().toISOString().slice(0, 10),
      bookings: dateBookings.rows.map((row) => ({ id: row.id, startsOn: row.starts_at ? new Date(row.starts_at).toISOString().slice(0, 10) : null, endsOn: row.ends_at ? new Date(row.ends_at).toISOString().slice(0, 10) : null, status: row.status })),
      facts: dateFacts.rows.map((row) => ({ id: row.id, startsOn: String(row.starts_on), endsOn: row.ends_on ? String(row.ends_on) : null, status: row.status, active: row.active })),
    });
    const dateKnowledge = eventDateAssistantKnowledge(effectiveEventDate);

    const latestBookingResult = await this.pool.query(
      `SELECT id
       FROM bookings
       WHERE organization_id = $1
         AND status NOT IN ('cancelled','declined')
       ORDER BY starts_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [organizationId],
    );
    const latestBookingId = latestBookingResult.rows[0]?.id as string | undefined;
    if (latestBookingId) {
      const bundle = await this.bookingContext.getBookingContext(latestBookingId);
      if (bundle) {
        return {
          ...bundle,
          businessKnowledge: dateKnowledge ? [...bundle.businessKnowledge, dateKnowledge] : bundle.businessKnowledge,
          context: {
            kind: "organization",
            recordId: organizationId,
            label: organization.name,
          },
        };
      }
    }

    const [contactsResult, activitiesResult, followUpsResult, familyResult, knowledge] =
      await Promise.all([
        this.pool.query(
          `SELECT c.id, c.first_name, c.last_name,
                  EXISTS (
                    SELECT 1 FROM organization_contacts oc2
                    WHERE oc2.organization_id = $1
                      AND oc2.contact_id = c.id
                      AND oc2.active = true
                  ) AS is_primary
           FROM organization_contacts oc
           JOIN contacts c ON c.id = oc.contact_id
           WHERE oc.organization_id = $1 AND oc.active = true
           ORDER BY c.last_name, c.first_name, c.id
           LIMIT 12`,
          [organizationId],
        ),
        this.pool.query(
          `SELECT id, kind, body,
                  COALESCE(occurred_at, timeline_sort_at, created_at) AS occurred_at
           FROM activities
           WHERE organization_id = $1 AND deleted_at IS NULL
           ORDER BY COALESCE(occurred_at, timeline_sort_at, created_at) DESC
           LIMIT 25`,
          [organizationId],
        ),
        this.pool.query(
          `SELECT id, kind, due_at
           FROM follow_ups
           WHERE organization_id = $1 AND completed_at IS NULL
           ORDER BY due_at, id
           LIMIT 12`,
          [organizationId],
        ),
        this.pool.query(
          `SELECT family_id FROM event_family_members WHERE organization_id = $1 LIMIT 1`,
          [organizationId],
        ),
        this.knowledge.listActiveForContext({
          packageTemplateIds: [],
          resourceIds: [],
          includeGlobal: true,
        }),
      ]);

    const contacts = contactsResult.rows.map((row, index) => ({
      id: row.id as string,
      label: contactLabel(row),
      isPrimary: index === 0,
    }));

    return buildBookingContextBundle({
      context: {
        kind: "organization",
        recordId: organizationId,
        label: organization.name,
      },
      profile: {
        organizationId,
        eventFamilyId: familyResult.rows[0]?.family_id ?? null,
        contacts,
      },
      currentBooking: null,
      priorBookings: [],
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
      packageHistorySignals: [],
      routeContext: null,
      derivedFacts: [],
      businessKnowledge: [...knowledge.map((entry) => ({
        id: entry.id,
        title: entry.title,
        body: entry.body,
      })), ...(dateKnowledge ? [{ id: dateKnowledge.id, title: dateKnowledge.title, body: dateKnowledge.body }] : [])],
      generatedAt: new Date(),
    });
  }

  async getEventFamilyContext(
    familyId: string,
  ): Promise<BookingAssistantContextBundle | null> {
    const familyResult = await this.pool.query(
      `SELECT id, name, description FROM event_families WHERE id = $1`,
      [familyId],
    );
    const family = familyResult.rows[0];
    if (!family) return null;

    const membersResult = await this.pool.query(
      `SELECT
         o.id,
         o.name,
         o.city,
         o.region,
         o.place_type,
         COUNT(b.id)::int AS booking_count
       FROM event_family_members efm
       JOIN organizations o ON o.id = efm.organization_id
       LEFT JOIN bookings b
         ON b.organization_id = o.id
        AND b.status NOT IN ('cancelled','declined')
       WHERE efm.family_id = $1
         AND o.consolidated_into_id IS NULL
       GROUP BY o.id, o.name, o.city, o.region, o.place_type
       ORDER BY o.name`,
      [familyId],
    );

    const members = membersResult.rows;
    const memberCount = members.length;
    const membersWithBookings = members.filter((member) => Number(member.booking_count ?? 0) > 0).length;
    const membersWithoutBookings = memberCount - membersWithBookings;
    const locations = [...new Set(
      members
        .map((member) => [member.city, member.region].filter(Boolean).join(", "))
        .filter(Boolean),
    )];
    const profileTypes = [...new Set(
      members
        .map((member) => String(member.place_type ?? "").trim())
        .filter(Boolean),
    )];
    const memberNames = members.map((member) => String(member.name));

    const familyKnowledge = [
      family.description
        ? {
            id: `event-family:${familyId}:description`,
            title: "Family description",
            body: String(family.description),
          }
        : null,
      {
        id: `event-family:${familyId}:members`,
        title: "Family members",
        body: `${memberCount} member profile${memberCount === 1 ? "" : "s"}${memberNames.length ? `: ${memberNames.join(", ")}` : ""}.`,
      },
      {
        id: `event-family:${familyId}:locations`,
        title: "Family locations",
        body: locations.length ? locations.join("; ") : "No member locations are saved yet.",
      },
      {
        id: `event-family:${familyId}:types`,
        title: "Family profile types",
        body: profileTypes.length ? profileTypes.join(", ") : "No profile types are saved yet.",
      },
      {
        id: `event-family:${familyId}:booking-history`,
        title: "Family booking history coverage",
        body: `${membersWithBookings} member profile${membersWithBookings === 1 ? " has" : "s have"} booking history; ${membersWithoutBookings} ${membersWithoutBookings === 1 ? "does" : "do"} not yet.`,
      },
    ].filter((entry): entry is { id: string; title: string; body: string } => Boolean(entry));

    return buildBookingContextBundle({
      context: { kind: "event_family", recordId: familyId, label: family.name },
      profile: {
        organizationId: null,
        eventFamilyId: familyId,
        contacts: [],
      },
      currentBooking: null,
      priorBookings: [],
      recentActivities: [],
      openFollowUps: [],
      packageHistorySignals: [],
      routeContext: null,
      derivedFacts: [],
      businessKnowledge: familyKnowledge,
      generatedAt: new Date(),
    });
  }
}
