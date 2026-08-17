import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import { buildBookingContextBundle } from "./booking-context-builder";
import { BookingContextRepository } from "./booking-context-repository";
import { PostgresBusinessKnowledgeRepository } from "./business-knowledge-repository";
import type { BookingAssistantContextBundle } from "./assistant-types";

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function contactLabel(row: any): string {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unnamed contact";
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
      businessKnowledge: knowledge.map((entry) => ({
        id: entry.id,
        title: entry.title,
        body: entry.body,
      })),
      generatedAt: new Date(),
    });
  }

  async getEventFamilyContext(
    familyId: string,
  ): Promise<BookingAssistantContextBundle | null> {
    const familyResult = await this.pool.query(
      `SELECT id, name FROM event_families WHERE id = $1`,
      [familyId],
    );
    const family = familyResult.rows[0];
    if (!family) return null;

    const latestResult = await this.pool.query(
      `SELECT b.id
       FROM bookings b
       JOIN event_family_members efm ON efm.organization_id = b.organization_id
       WHERE efm.family_id = $1
         AND b.status NOT IN ('cancelled','declined')
       ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
       LIMIT 1`,
      [familyId],
    );
    const latestBookingId = latestResult.rows[0]?.id as string | undefined;
    if (latestBookingId) {
      const bundle = await this.bookingContext.getBookingContext(latestBookingId);
      if (bundle) {
        return {
          ...bundle,
          context: {
            kind: "event_family",
            recordId: familyId,
            label: family.name,
          },
          profile: {
            ...bundle.profile,
            eventFamilyId: familyId,
          },
        };
      }
    }

    const organizationResult = await this.pool.query(
      `SELECT organization_id
       FROM event_family_members
       WHERE family_id = $1
       ORDER BY created_at
       LIMIT 1`,
      [familyId],
    );
    const organizationId = organizationResult.rows[0]?.organization_id as string | undefined;
    if (organizationId) {
      const bundle = await this.getOrganizationContext(organizationId);
      if (bundle) {
        return {
          ...bundle,
          context: {
            kind: "event_family",
            recordId: familyId,
            label: family.name,
          },
          profile: { ...bundle.profile, eventFamilyId: familyId },
        };
      }
    }

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
      businessKnowledge: [],
      generatedAt: new Date(),
    });
  }
}
