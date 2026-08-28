import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingOpportunities,
  bookings,
  contacts,
  googleWorkspaceCalendarScopes,
  googleWorkspaceConnections,
  organizations,
  packageTemplates,
} from "@/db/schema";
import type { DraftRecipientCandidate } from "./draft-context-resolver";
import type { PackageAvailabilityTemplate } from "@/features/lead-intake/package-availability";

type DrizzleDatabase = typeof database;

export type OpportunityEmailProfileEvidence = {
  eventName: string;
  city: string | null;
  region: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

export class OpportunityEmailProfileRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async getProfile(
    organizationId: string,
    _eventYear: number,
    bookingId: string | null,
  ): Promise<OpportunityEmailProfileEvidence> {
    if (bookingId) {
      const [booking] = await this.database
        .select({
          name: bookings.name,
          city: bookings.city,
          region: bookings.region,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
        })
        .from(bookings)
        .where(and(
          eq(bookings.id, bookingId),
          eq(bookings.organizationId, organizationId),
        ))
        .limit(1);
      if (booking) {
        return {
          eventName: booking.name,
          city: booking.city,
          region: booking.region,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
        };
      }
    }

    const [organization] = await this.database
      .select({
        name: organizations.name,
        city: organizations.city,
        region: organizations.region,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
    return {
      eventName: organization.name,
      city: organization.city,
      region: organization.region,
      startsAt: null,
      endsAt: null,
    };
  }

  async name(
    organizationId: string,
    eventYear: number,
    bookingId: string | null,
  ): Promise<string> {
    return (await this.getProfile(organizationId, eventYear, bookingId)).eventName;
  }

  async listVerifiedRecipients(
    organizationId: string,
    eventYear: number,
  ): Promise<DraftRecipientCandidate[]> {
    const [opportunity] = await this.database
      .select({
        contactId: bookingOpportunities.contactId,
        selectedAt: bookingOpportunities.updatedAt,
      })
      .from(bookingOpportunities)
      .where(and(
        eq(bookingOpportunities.organizationId, organizationId),
        eq(bookingOpportunities.eventYear, eventYear),
      ))
      .limit(1);
    if (!opportunity?.contactId) return [];

    const [contact] = await this.database
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
      })
      .from(contacts)
      .where(eq(contacts.id, opportunity.contactId))
      .limit(1);
    const email = contact?.email?.trim().toLowerCase();
    if (!contact || !email) return [];

    const name = [contact.firstName, contact.lastName]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" ") || null;
    return [{
      contactId: contact.id,
      email,
      name,
      // The explicit Opportunity → Contact link is the human selection boundary.
      // Do not auto-promote unrelated organization/ACT emails into this list.
      verifiedAt: opportunity.selectedAt,
      source: "profile",
    }];
  }

  async getBooking(id: string) {
    const [booking] = await this.database
      .select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
      .from(bookings)
      .where(eq(bookings.id, id))
      .limit(1);
    return booking ?? null;
  }

  async selectedCalendars() {
    return this.database
      .select({
        id: googleWorkspaceCalendarScopes.calendarId,
        summary: googleWorkspaceCalendarScopes.summary,
        primary: googleWorkspaceCalendarScopes.primaryCalendar,
      })
      .from(googleWorkspaceCalendarScopes)
      .innerJoin(
        googleWorkspaceConnections,
        eq(googleWorkspaceConnections.id, googleWorkspaceCalendarScopes.connectionId),
      )
      .where(and(
        eq(googleWorkspaceCalendarScopes.selected, true),
        eq(googleWorkspaceConnections.status, "connected"),
      ))
      .orderBy(
        googleWorkspaceCalendarScopes.summary,
        googleWorkspaceCalendarScopes.calendarId,
      );
  }

  async activePackages(): Promise<PackageAvailabilityTemplate[]> {
    return this.database
      .select({
        code: packageTemplates.code,
        name: packageTemplates.name,
        normalCapacity: packageTemplates.normalCapacity,
        temporaryUnavailableQuantity: packageTemplates.temporaryUnavailableQuantity,
      })
      .from(packageTemplates)
      .where(eq(packageTemplates.active, true));
  }
}
