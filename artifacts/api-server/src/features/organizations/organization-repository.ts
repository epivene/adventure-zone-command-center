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
  actExternalLinks,
  actMigrationRecords,
  activities,
  bookings,
  callSessions,
  contacts,
  followUps,
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

export type DuplicateOrganizationGroup = {
  normalizedName: string;
  city: string;
  region: string;
  organizations: OrganizationListRecord[];
};

export interface OrganizationRepository {
  setLastResort(input: SetLastResortInput, changedAt: Date): Promise<boolean>;
  getOrganizationSummary(
    organizationId: string,
    query?: OrganizationSummaryQuery,
  ): Promise<OrganizationSummary | null>;
  findDuplicates(): Promise<DuplicateOrganizationGroup[]>;
  mergeOrganizations(primaryId: string, duplicateIds: string[]): Promise<void>;
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

/** Candidate groups are intentionally name-based; location gaps are common in imported profiles. */
export function duplicateOrganizationGroupsQuery() {
  return sql`
    SELECT
      lower(trim(name)) AS normalized_name,
      min(lower(trim(coalesce(city, '')))) AS normalized_city,
      min(lower(trim(coalesce(region, '')))) AS normalized_region,
      array_agg(id ORDER BY created_at ASC) AS ids
    FROM organizations
    GROUP BY 1
    HAVING count(*) > 1
    ORDER BY lower(trim(name))
  `;
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

  async findDuplicates(): Promise<DuplicateOrganizationGroup[]> {
    // This is a review list, not an automatic merge. Imported records often have
    // no location even when an existing same-name profile does.
    const groupRows = await this.database.execute<{
      normalized_name: string;
      normalized_city: string;
      normalized_region: string;
      ids: string[];
    }>(duplicateOrganizationGroupsQuery());

    if (!groupRows.rows.length) return [];

    // Collect all IDs across all groups
    const allIds = groupRows.rows.flatMap((row) => row.ids);
    if (!allIds.length) return [];

    const orgRecords = await this.database
      .select()
      .from(organizations)
      .where(inArray(organizations.id, allIds))
      .orderBy(asc(organizations.name), asc(organizations.id));

    const organizationIds = orgRecords.map((o) => o.id);

    const [contactCounts, bookingCounts, primaryContacts] = await Promise.all([
      this.database
        .select({ organizationId: organizationContacts.organizationId, value: count() })
        .from(organizationContacts)
        .where(and(
          inArray(organizationContacts.organizationId, organizationIds),
          eq(organizationContacts.active, true),
        ))
        .groupBy(organizationContacts.organizationId),
      this.database
        .select({ organizationId: bookings.organizationId, value: count() })
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

    const contactCountByOrg = new Map(contactCounts.map((r) => [r.organizationId, r.value]));
    const bookingCountByOrg = new Map(
      bookingCounts.filter((r) => r.organizationId !== null).map((r) => [r.organizationId!, r.value]),
    );
    const primaryContactByOrg = new Map(
      primaryContacts.map((r) => [r.organizationId, `${r.firstName} ${r.lastName}`.trim()]),
    );

    const orgById = new Map(orgRecords.map((o) => [o.id, o]));

    return groupRows.rows.map((row) => {
      const orgs: OrganizationListRecord[] = row.ids
        .map((id) => {
          const o = orgById.get(id);
          if (!o) return null;
          return {
            id: o.id,
            name: o.name,
            city: o.city,
            region: o.region,
            lastResort: o.lastResort,
            lastResortReason: o.lastResortReason,
            lastResortChangedAt: o.lastResortChangedAt,
            contactCount: contactCountByOrg.get(o.id) ?? 0,
            bookingCount: bookingCountByOrg.get(o.id) ?? 0,
            primaryContactName: primaryContactByOrg.get(o.id) ?? null,
          } satisfies OrganizationListRecord;
        })
        .filter(Boolean) as OrganizationListRecord[];

      return {
        normalizedName: row.normalized_name,
        city: row.normalized_city,
        region: row.normalized_region,
        organizations: orgs,
      };
    });
  }

  async mergeOrganizations(primaryId: string, duplicateIds: string[]): Promise<void> {
    if (!duplicateIds.length) return;

    await this.database.transaction(async (tx) => {
      const now = new Date();

      for (const dupId of duplicateIds) {
        // Step 1: Create organization_contacts entries on the primary for every
        // contact currently belonging to the duplicate. This MUST happen before
        // updating contacts.organization_id because the schema enforces a
        // composite FK: contacts(organization_id, id) →
        // organization_contacts(organization_id, contact_id). Without a matching
        // row on the primary side the FK check would fail when we re-parent
        // contacts in step 2.
        //
        // Force isPrimary=false on incoming rows so we never violate the
        // one-active-primary-per-org partial unique index. The primary's
        // existing primary designation is left untouched.
        await tx.execute(sql`
          INSERT INTO organization_contacts
            (id, organization_id, contact_id, role, is_primary, active, source, created_at, updated_at)
          SELECT
            gen_random_uuid(),
            ${primaryId},
            contact_id,
            role,
            false,
            active,
            source,
            created_at,
            ${now}
          FROM organization_contacts
          WHERE organization_id = ${dupId}
          ON CONFLICT (organization_id, contact_id) DO NOTHING
        `);

        // Step 2: Re-parent contacts — now safe because every contact that had
        // organization_id = dupId has a matching organization_contacts row for
        // primaryId (inserted above or already present).
        await tx.update(contacts)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(contacts.organizationId, dupId));

        // Step 3: Remove the now-redundant organization_contacts rows for the
        // duplicate. Contacts no longer point to dupId, so no FK is violated.
        await tx.delete(organizationContacts)
          .where(eq(organizationContacts.organizationId, dupId));

        // Step 4: Re-parent bookings
        await tx.update(bookings)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(bookings.organizationId, dupId));

        // Step 5: Re-parent follow_ups
        await tx.update(followUps)
          .set({ organizationId: primaryId })
          .where(eq(followUps.organizationId, dupId));

        // Step 6: Re-parent activities
        await tx.update(activities)
          .set({ organizationId: primaryId, updatedAt: now })
          .where(eq(activities.organizationId, dupId));

        // Step 7: Re-parent call_sessions
        await tx.update(callSessions)
          .set({ organizationId: primaryId })
          .where(eq(callSessions.organizationId, dupId));

        // Step 8: Re-parent act_external_links.
        // Clear isPrimary first to avoid the one-primary-per-local-source
        // partial unique index conflict before changing entityId.
        await tx.update(actExternalLinks)
          .set({ isPrimary: false })
          .where(and(
            eq(actExternalLinks.entityId, dupId),
            eq(actExternalLinks.entityType, "organization"),
          ));
        await tx.update(actExternalLinks)
          .set({ entityId: primaryId, updatedAt: now })
          .where(and(
            eq(actExternalLinks.entityId, dupId),
            eq(actExternalLinks.entityType, "organization"),
          ));

        // Step 9: Re-parent act_migration_records matched/applied entity pointers
        await tx.update(actMigrationRecords)
          .set({ matchedEntityId: primaryId, updatedAt: now })
          .where(and(
            eq(actMigrationRecords.matchedEntityId, dupId),
            eq(actMigrationRecords.matchedEntityType, "organization"),
          ));
        await tx.update(actMigrationRecords)
          .set({ appliedEntityId: primaryId, updatedAt: now })
          .where(and(
            eq(actMigrationRecords.appliedEntityId, dupId),
            eq(actMigrationRecords.matchedEntityType, "organization"),
          ));

        // Step 10: Delete the now-empty duplicate
        await tx.delete(organizations).where(eq(organizations.id, dupId));
      }
    });
  }
}
