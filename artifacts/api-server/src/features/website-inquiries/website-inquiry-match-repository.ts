import {
  and,
  asc,
  between,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  bookings,
  contacts,
  organizationContacts,
  organizations,
  websiteInquiries,
} from "@/db/schema";
import { normalizeMatchingText } from "../act-migration/matching-normalization";
import { parseCityRegion } from "./website-inquiry-matching";
import type {
  ContactMatchSource,
  InquiryMatchSource,
  MatchCandidate,
  OrganizationMatchSource,
  WebsiteInquiryMatchRepository,
} from "./website-inquiry-matching";

function tokens(value: string): string[] {
  return [
    ...new Set(
      (normalizeMatchingText(value) ?? "")
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 2),
    ),
  ].slice(0, 6);
}

function pattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export class DrizzleWebsiteInquiryMatchRepository
  implements WebsiteInquiryMatchRepository
{
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async loadInquiry(id: string): Promise<InquiryMatchSource | null> {
    const [inquiry] = await this.database
      .select({
        id: websiteInquiries.id,
        name: websiteInquiries.name,
        normalizedEmail: websiteInquiries.normalizedEmail,
        eventName: websiteInquiries.eventName,
        eventDate: websiteInquiries.eventDate,
        eventLocation: websiteInquiries.eventLocation,
      })
      .from(websiteInquiries)
      .where(eq(websiteInquiries.id, id))
      .limit(1);
    return inquiry ?? null;
  }

  async loadContactCandidates(
    inquiry: InquiryMatchSource,
  ): Promise<ContactMatchSource[]> {
    const predicates = [
      sql`lower(trim(${contacts.email})) = ${inquiry.normalizedEmail}`,
      ...tokens(inquiry.name).flatMap((token) => [
        ilike(contacts.firstName, pattern(token)),
        ilike(contacts.lastName, pattern(token)),
      ]),
    ];
    const rows = await this.database
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
      })
      .from(contacts)
      .where(or(...predicates))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id))
      .limit(100);
    if (rows.length === 0) return [];

    const relationships = await this.database
      .select({
        contactId: organizationContacts.contactId,
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        region: organizations.region,
      })
      .from(organizationContacts)
      .innerJoin(
        organizations,
        eq(organizationContacts.organizationId, organizations.id),
      )
      .where(
        and(
          inArray(
            organizationContacts.contactId,
            rows.map(({ id }) => id),
          ),
          eq(organizationContacts.active, true),
          isNull(organizations.consolidatedIntoId),
        ),
      );
    return rows.map((contact) => ({
      ...contact,
      organizations: relationships
        .filter(({ contactId }) => contactId === contact.id)
        .map(({ contactId: _contactId, ...organization }) => organization),
    }));
  }

  async loadOrganizationCandidates(
    inquiry: InquiryMatchSource,
  ): Promise<OrganizationMatchSource[]> {
    const location = parseCityRegion(inquiry.eventLocation);
    const predicates = tokens(inquiry.eventName).map((token) =>
      ilike(organizations.name, pattern(token)),
    );
    if (location) {
      predicates.push(
        and(
          ilike(organizations.city, location.city),
          sql`upper(${organizations.region}) = ${location.region}`,
        )!,
      );
    }
    const named = await this.database
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(isNull(organizations.consolidatedIntoId), or(...predicates)))
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(100);

    const nearbyBookingOrganizationIds: string[] = [];
    if (inquiry.eventDate) {
      const event = new Date(`${inquiry.eventDate}T12:00:00.000Z`);
      const start = new Date(event.getTime() - 60 * 86_400_000);
      const end = new Date(event.getTime() + 60 * 86_400_000);
      const nearby = await this.database
        .select({ organizationId: bookings.organizationId })
        .from(bookings)
        .where(between(bookings.startsAt, start, end))
        .limit(100);
      nearbyBookingOrganizationIds.push(
        ...nearby.flatMap(({ organizationId }) =>
          organizationId ? [organizationId] : [],
        ),
      );
    }
    const ids = [...new Set([...named.map(({ id }) => id), ...nearbyBookingOrganizationIds])].slice(
      0,
      100,
    );
    if (ids.length === 0) return [];

    const [profiles, bookingRows, relationships] = await Promise.all([
      this.database
        .select({
          id: organizations.id,
          name: organizations.name,
          city: organizations.city,
          region: organizations.region,
        })
        .from(organizations)
        .where(
          and(
            inArray(organizations.id, ids),
            isNull(organizations.consolidatedIntoId),
          ),
        ),
      this.database
        .select({
          organizationId: bookings.organizationId,
          startsAt: bookings.startsAt,
        })
        .from(bookings)
        .where(inArray(bookings.organizationId, ids)),
      this.database
        .select({
          organizationId: organizationContacts.organizationId,
          contactId: organizationContacts.contactId,
        })
        .from(organizationContacts)
        .where(
          and(
            inArray(organizationContacts.organizationId, ids),
            eq(organizationContacts.active, true),
          ),
        ),
    ]);
    return profiles.map((profile) => ({
      ...profile,
      bookings: bookingRows
        .filter(({ organizationId }) => organizationId === profile.id)
        .map(({ startsAt }) => ({ startsAt })),
      relatedContactIds: relationships
        .filter(({ organizationId }) => organizationId === profile.id)
        .map(({ contactId }) => contactId),
    }));
  }

  async search(input: {
    entity: "contact" | "organization";
    query: string;
  }): Promise<MatchCandidate[]> {
    const contains = pattern(input.query.trim());
    if (input.entity === "contact") {
      const rows = await this.database
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          city: contacts.city,
          region: contacts.region,
        })
        .from(contacts)
        .where(
          or(
            ilike(contacts.firstName, contains),
            ilike(contacts.lastName, contains),
            ilike(contacts.email, contains),
            ilike(sql<string>`${contacts.firstName} || ' ' || ${contacts.lastName}`, contains),
          ),
        )
        .orderBy(asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id))
        .limit(20);
      return rows.map((row) => ({
        id: row.id,
        label: `${row.firstName} ${row.lastName}`.trim(),
        score: 0,
        reasons: [],
        context: { email: row.email, city: row.city, region: row.region },
      }));
    }

    const rows = await this.database
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        region: organizations.region,
      })
      .from(organizations)
      .where(
        and(
          isNull(organizations.consolidatedIntoId),
          or(
            ilike(organizations.name, contains),
            ilike(organizations.city, contains),
          ),
        ),
      )
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(20);
    return rows.map((row) => ({
      id: row.id,
      label: row.name,
      score: 0,
      reasons: [],
      context: { city: row.city, region: row.region },
    }));
  }
}
