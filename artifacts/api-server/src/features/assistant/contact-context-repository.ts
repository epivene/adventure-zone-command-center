import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

import { buildBookingContextBundle } from "./booking-context-builder";
import { BookingContextRepository } from "./booking-context-repository";
import { PostgresBusinessKnowledgeRepository } from "./business-knowledge-repository";
import type { BookingAssistantContextBundle } from "./assistant-types";

export class ContactContextRepository {
  private readonly bookingContext: BookingContextRepository;
  private readonly knowledge: PostgresBusinessKnowledgeRepository;

  constructor(private readonly pool: Pool = defaultPool) {
    this.bookingContext = new BookingContextRepository(pool);
    this.knowledge = new PostgresBusinessKnowledgeRepository(pool);
  }

  async getContactContext(
    contactId: string,
  ): Promise<BookingAssistantContextBundle | null> {
    const contactResult = await this.pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.organization_id,
              oc.organization_id AS linked_organization_id
       FROM contacts c
       LEFT JOIN organization_contacts oc
         ON oc.contact_id = c.id AND oc.active = true
       WHERE c.id = $1
       ORDER BY oc.is_primary DESC NULLS LAST, oc.created_at
       LIMIT 1`,
      [contactId],
    );
    const contact = contactResult.rows[0];
    if (!contact) return null;

    const label = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "Contact";
    const organizationId =
      (contact.organization_id as string | null) ??
      (contact.linked_organization_id as string | null) ??
      null;

    const latestBookingResult = await this.pool.query(
      `SELECT b.id
       FROM bookings b
       LEFT JOIN booking_contacts bc ON bc.booking_id = b.id
       WHERE (b.primary_contact_id = $1 OR bc.contact_id = $1)
         AND b.status NOT IN ('cancelled','declined')
       ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
       LIMIT 1`,
      [contactId],
    );
    const latestBookingId = latestBookingResult.rows[0]?.id as string | undefined;
    if (latestBookingId) {
      const bundle = await this.bookingContext.getBookingContext(latestBookingId);
      if (bundle) {
        return {
          ...bundle,
          context: { kind: "contact", recordId: contactId, label },
          profile: {
            ...bundle.profile,
            organizationId: organizationId ?? bundle.profile.organizationId,
            contacts: bundle.profile.contacts.some((row) => row.id === contactId)
              ? bundle.profile.contacts
              : [{ id: contactId, label, isPrimary: true }, ...bundle.profile.contacts],
          },
        };
      }
    }

    const [activitiesResult, followUpsResult, knowledge] = await Promise.all([
      this.pool.query(
        `SELECT id, kind, body,
                COALESCE(occurred_at, timeline_sort_at, created_at) AS occurred_at
         FROM activities
         WHERE contact_id = $1 AND deleted_at IS NULL
         ORDER BY COALESCE(occurred_at, timeline_sort_at, created_at) DESC
         LIMIT 25`,
        [contactId],
      ),
      this.pool.query(
        `SELECT id, kind, due_at
         FROM follow_ups
         WHERE contact_id = $1 AND completed_at IS NULL
         ORDER BY due_at, id
         LIMIT 12`,
        [contactId],
      ),
      this.knowledge.listActiveForContext({
        packageTemplateIds: [],
        resourceIds: [],
        includeGlobal: true,
      }),
    ]);

    return buildBookingContextBundle({
      context: { kind: "contact", recordId: contactId, label },
      profile: {
        organizationId,
        eventFamilyId: null,
        contacts: [{ id: contactId, label, isPrimary: true }],
      },
      currentBooking: null,
      priorBookings: [],
      recentActivities: activitiesResult.rows.map((row) => ({
        id: row.id as string,
        kind: String(row.kind),
        summary: String(row.body ?? "").trim().slice(0, 600),
        occurredAt: row.occurred_at ? new Date(row.occurred_at) : null,
      })),
      openFollowUps: followUpsResult.rows.map((row) => ({
        id: row.id as string,
        kind: String(row.kind),
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
}
