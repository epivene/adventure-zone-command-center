import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  type SQL,
  sql,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookings,
  contacts,
  organizationContacts,
  organizations,
  travelLegs,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type { SetLastResortInput } from "@/features/organizations/last-resort-input";

export type OrganizationPerson = {
  id: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
};
export type OrganizationContact = OrganizationPerson;
export type OrganizationBooking = {
  id: string;
  name: string;
  travelLeg: { id: string; name: string; color: string } | null;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  lastResort: boolean;
  lastResortReason: string | null;
  lastResortChangedAt: Date | null;
  contacts: OrganizationContact[];
  bookings: OrganizationBooking[];
  contactTotal?: number;
  contactPage?: number;
  contactPageCount?: number;
  bookingTotal?: number;
  bookingPage?: number;
  bookingPageCount?: number;
};

export type OrganizationSummaryQuery = {
  contactPage: number;
  bookingPage: number;
  pageSize: number;
};

export type OrganizationListQuery = {
  search: string;
  lastResort: "all" | "only";
  travelLegId: string | null;
  page: number;
  pageSize: number;
};

export type OrganizationListRecord = Omit<
  OrganizationSummary,
  "contacts" | "bookings"
> & {
  contactCount: number;
  bookingCount: number;
  city: string | null;
  region: string | null;
  primaryContactName: string | null;
};

export type OrganizationListPage = {
  records: OrganizationListRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** Shared predicate for reads that only consider the live place-person association. */
export function activeOrganizationContactCondition(organizationId: string) {
  return and(
    eq(organizationContacts.organizationId, organizationId),
    eq(organizationContacts.active, true),
  )!;
}

export interface OrganizationRepository {
  setLastResort(input: SetLastResortInput, changedAt: Date): Promise<boolean>;
  getOrganizationSummary(
    organizationId: string,
    query?: OrganizationSummaryQuery,
  ): Promise<OrganizationSummary | null>;
}

type DrizzleDatabase = typeof database;

function lastResortSnapshot(record: typeof organizations.$inferSelect) {
  return {
    lastResort: record.lastResort,
    lastResortReason: record.lastResortReason,
    lastResortChangedAt: record.lastResortChangedAt?.toISOString() ?? null,
  };
}

function toOrganizationBooking(record: {
  booking: typeof bookings.$inferSelect;
  travelLeg: typeof travelLegs.$inferSelect | null;
}): OrganizationBooking {
  return {
    id: record.booking.id,
    name: record.booking.name,
    travelLeg: record.travelLeg
      ? {
          id: record.travelLeg.id,
          name: record.travelLeg.name,
          color: record.travelLeg.color,
        }
      : null,
  };
}

export function buildOrganizationListCondition(
  query: OrganizationListQuery,
): SQL | undefined {
  const searchCondition = query.search
    ? ilike(organizations.name, `%${query.search}%`)
    : undefined;
  const lastResortCondition =
    query.lastResort === "only" ? eq(organizations.lastResort, true) : undefined;
  const travelLegCondition = query.travelLegId
    ? sql`exists (select 1 from ${bookings} where ${bookings.organizationId} = ${organizations.id} and ${bookings.travelLegId} = ${query.travelLegId})`
    : undefined;

  return and(searchCondition, lastResortCondition, travelLegCondition) ?? undefined;
}

export class DrizzleOrganizationRepository implements OrganizationRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async setLastResort(
    input: SetLastResortInput,
    changedAt: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.organizationId))
        .limit(1)
        .for("update");
      if (!before) return false;

      const [updated] = await transaction
        .update(organizations)
        .set({
          lastResort: input.enabled,
          lastResortReason: input.enabled ? input.reason : null,
          lastResortChangedAt: changedAt,
          updatedAt: changedAt,
        })
        .where(eq(organizations.id, input.organizationId))
        .returning();
      if (!updated) throw new Error("Could not update the organization.");

      await recordAuditEntry(transaction, {
        entityType: "organization",
        entityId: input.organizationId,
        action: input.enabled ? "last_resort_enabled" : "last_resort_cleared",
        before: lastResortSnapshot(before),
        after: lastResortSnapshot(updated),
      });
      return true;
    });
  }

  async getOrganizationSummary(
    organizationId: string,
    query: OrganizationSummaryQuery = {
      contactPage: 1,
      bookingPage: 1,
      pageSize: 25,
    },
  ): Promise<OrganizationSummary | null> {
    const [organization] = await this.database
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) return null;

    const [[contactTotalRecord], [bookingTotalRecord]] = await Promise.all([
      this.database
        .select({ value: count() })
        .from(organizationContacts)
        .where(and(
          eq(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.active, true),
        )),
      this.database
        .select({ value: count() })
        .from(bookings)
        .where(eq(bookings.organizationId, organizationId)),
    ]);
    const contactTotal = contactTotalRecord?.value ?? 0;
    const bookingTotal = bookingTotalRecord?.value ?? 0;
    const contactPageCount = Math.max(1, Math.ceil(contactTotal / query.pageSize));
    const bookingPageCount = Math.max(1, Math.ceil(bookingTotal / query.pageSize));
    const contactPage = Math.min(
      Math.max(1, query.contactPage),
      contactPageCount,
    );
    const bookingPage = Math.min(
      Math.max(1, query.bookingPage),
      bookingPageCount,
    );

    const [organizationPeople, organizationBookings] = await Promise.all([
      this.database
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          role: organizationContacts.role,
          isPrimary: organizationContacts.isPrimary,
          phone: contacts.phone,
          email: contacts.email,
        })
        .from(organizationContacts)
        .innerJoin(contacts, eq(organizationContacts.contactId, contacts.id))
        .where(and(
          eq(organizationContacts.organizationId, organizationId),
          eq(organizationContacts.active, true),
        ))
        .orderBy(
          desc(organizationContacts.isPrimary),
          asc(organizationContacts.role),
          asc(contacts.lastName),
          asc(contacts.firstName),
          asc(contacts.id),
        )
        .limit(query.pageSize)
        .offset((contactPage - 1) * query.pageSize),
      this.database
        .select({ booking: bookings, travelLeg: travelLegs })
        .from(bookings)
        .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
        .where(eq(bookings.organizationId, organizationId))
        .orderBy(desc(bookings.startsAt), asc(bookings.name), asc(bookings.id))
        .limit(query.pageSize)
        .offset((bookingPage - 1) * query.pageSize),
    ]);

    return {
      id: organization.id,
      name: organization.name,
      lastResort: organization.lastResort,
      lastResortReason: organization.lastResortReason,
      lastResortChangedAt: organization.lastResortChangedAt,
      contacts: organizationPeople.map((contact) => ({
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        role: contact.role,
        isPrimary: contact.isPrimary,
        phone: contact.phone,
        email: contact.email,
      })),
      bookings: organizationBookings.map(toOrganizationBooking),
      contactTotal,
      contactPage,
      contactPageCount,
      bookingTotal,
      bookingPage,
      bookingPageCount,
    };
  }

  async listOrganizations(query: OrganizationListQuery): Promise<OrganizationListPage> {
    const condition = buildOrganizationListCondition(query);
    const [totals] = await this.database
      .select({ value: count() })
      .from(organizations)
      .where(condition);
    const total = totals?.value ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, pageCount);
    const organizationRecords = await this.database
      .select()
      .from(organizations)
      .where(condition)
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);
    if (!organizationRecords.length) {
      return { records: [], total, page, pageSize: query.pageSize, pageCount };
    }

    const organizationIds = organizationRecords.map((organization) => organization.id);
    const [contactCounts, bookingCounts, primaryContacts] = await Promise.all([
      this.database
        .select({
          organizationId: organizationContacts.organizationId,
          value: count(),
        })
        .from(organizationContacts)
        .where(and(
          inArray(organizationContacts.organizationId, organizationIds),
          eq(organizationContacts.active, true),
        ))
        .groupBy(organizationContacts.organizationId),
      this.database
        .select({
          organizationId: bookings.organizationId,
          value: count(),
        })
        .from(bookings)
        .where(inArray(bookings.organizationId, organizationIds))
        .groupBy(bookings.organizationId),
      this.database
        .select({
          organizationId: organizationContacts.organizationId,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
        })
        .from(organizationContacts)
        .innerJoin(contacts, eq(organizationContacts.contactId, contacts.id))
        .where(and(
          inArray(organizationContacts.organizationId, organizationIds),
          eq(organizationContacts.active, true),
          eq(organizationContacts.isPrimary, true),
        )),
    ]);
    const contactCountByOrganization = new Map(
      contactCounts.map((record) => [record.organizationId, record.value]),
    );
    const bookingCountByOrganization = new Map(
      bookingCounts
        .filter((record) => record.organizationId !== null)
        .map((record) => [record.organizationId!, record.value]),
    );
    const primaryContactByOrganization = new Map(
      primaryContacts.map((record) => [
        record.organizationId,
        `${record.firstName} ${record.lastName}`.trim(),
      ]),
    );

    return {
      records: organizationRecords.map((organization) => ({
        id: organization.id,
        name: organization.name,
        city: organization.city,
        region: organization.region,
        lastResort: organization.lastResort,
        lastResortReason: organization.lastResortReason,
        lastResortChangedAt: organization.lastResortChangedAt,
        contactCount: contactCountByOrganization.get(organization.id) ?? 0,
        bookingCount: bookingCountByOrganization.get(organization.id) ?? 0,
        primaryContactName: primaryContactByOrganization.get(organization.id) ?? null,
      })),
      total,
      page,
      pageSize: query.pageSize,
      pageCount,
    };
  }

  async listTravelLegs() {
    return this.database
      .select({ id: travelLegs.id, name: travelLegs.name, color: travelLegs.color })
      .from(travelLegs)
      .orderBy(asc(travelLegs.sortOrder));
  }
}
