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

export type OrganizationParentSummary = {
  id: string;
  name: string;
  website: string | null;
};

export type OrganizationLocationSummary = {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  localStatus: string | null;
  nextFollowUp: { id: string; kind: string; dueAt: Date } | null;
  nextBooking: {
    id: string;
    name: string;
    startsAt: Date | null;
    status: string;
  } | null;
  travelLeg: { id: string; name: string; color: string } | null;
  primaryContactName: string | null;
};

export type OrganizationHierarchyRollups = {
  locationCount: number;
  upcomingBookingCount: number;
  overdueFollowUpCount: number;
  travelLegs: Array<{ id: string; name: string; color: string }>;
  mostRecentContactAt: Date | null;
};

export type OrganizationLocationAggregateRecord = {
  id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  localStatus: string | null;
  nextFollowUpId: string | null;
  nextFollowUpKind: string | null;
  nextFollowUpDueAt: Date | null;
  nextBookingId: string | null;
  nextBookingName: string | null;
  nextBookingStartsAt: Date | null;
  nextBookingStatus: string | null;
  travelLegId: string | null;
  travelLegName: string | null;
  travelLegColor: string | null;
  primaryContactFirstName: string | null;
  primaryContactLastName: string | null;
};

export type OrganizationHierarchySummary = {
  parent: OrganizationParentSummary | null;
  locations: OrganizationLocationSummary[];
  rollups: OrganizationHierarchyRollups;
};

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
  parent: OrganizationParentSummary | null;
  locations: OrganizationLocationSummary[];
  rollups: OrganizationHierarchyRollups;
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
  "contacts" | "bookings" | "parent" | "locations" | "rollups"
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



const emptyHierarchyRollupRecord = {
  locationCount: 0,
  upcomingBookingCount: 0,
  overdueFollowUpCount: 0,
  mostRecentContactAt: null,
};

export function assembleOrganizationHierarchy(
  parent: OrganizationParentSummary | null,
  locationRecords: OrganizationLocationAggregateRecord[],
  rollupRecord: Omit<OrganizationHierarchyRollups, "travelLegs"> = emptyHierarchyRollupRecord,
  representedTravelLegs: OrganizationHierarchyRollups["travelLegs"] = [],
): OrganizationHierarchySummary {
  return {
    parent,
    locations: locationRecords
      .map((record) => ({
        id: record.id,
        name: record.name,
        address1: record.address1,
        address2: record.address2,
        city: record.city,
        region: record.region,
        postalCode: record.postalCode,
        website: record.website,
        localStatus: record.localStatus,
        nextFollowUp:
          record.nextFollowUpId &&
          record.nextFollowUpKind &&
          record.nextFollowUpDueAt
            ? {
                id: record.nextFollowUpId,
                kind: record.nextFollowUpKind,
                dueAt: record.nextFollowUpDueAt,
              }
            : null,
        nextBooking:
          record.nextBookingId &&
          record.nextBookingName &&
          record.nextBookingStatus
            ? {
                id: record.nextBookingId,
                name: record.nextBookingName,
                startsAt: record.nextBookingStartsAt,
                status: record.nextBookingStatus,
              }
            : null,
        travelLeg:
          record.travelLegId &&
          record.travelLegName &&
          record.travelLegColor
            ? {
                id: record.travelLegId,
                name: record.travelLegName,
                color: record.travelLegColor,
              }
            : null,
        primaryContactName:
          record.primaryContactFirstName || record.primaryContactLastName
            ? `${record.primaryContactFirstName ?? ""} ${record.primaryContactLastName ?? ""}`.trim()
            : null,
      }))
      .toSorted(
        (left, right) =>
          left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      ),
    rollups: {
      locationCount: Number(rollupRecord.locationCount),
      upcomingBookingCount: Number(rollupRecord.upcomingBookingCount),
      overdueFollowUpCount: Number(rollupRecord.overdueFollowUpCount),
      travelLegs: representedTravelLegs,
      mostRecentContactAt: rollupRecord.mostRecentContactAt,
    },
  };
}

export async function loadOrganizationHierarchySummary(
  database: DrizzleDatabase,
  organization: { id: string; parentOrganizationId: string | null },
): Promise<OrganizationHierarchySummary> {
  if (organization.parentOrganizationId) {
    const [parent] = await database
      .select({
        id: organizations.id,
        name: organizations.name,
        website: organizations.website,
      })
      .from(organizations)
      .where(eq(organizations.id, organization.parentOrganizationId))
      .limit(1);

    return assembleOrganizationHierarchy(parent ?? null, []);
  }

  const [locationResult, rollupResult, travelLegResult] = await Promise.all([
    database.execute<OrganizationLocationAggregateRecord>(sql`
      SELECT
        child.id,
        child.name,
        child.address_1 AS "address1",
        child.address_2 AS "address2",
        child.city,
        child.region,
        child.postal_code AS "postalCode",
        child.website,
        next_booking.status::text AS "localStatus",
        next_follow_up.id AS "nextFollowUpId",
        next_follow_up.kind AS "nextFollowUpKind",
        next_follow_up.due_at AS "nextFollowUpDueAt",
        next_booking.id AS "nextBookingId",
        next_booking.name AS "nextBookingName",
        next_booking.starts_at AS "nextBookingStartsAt",
        next_booking.status::text AS "nextBookingStatus",
        next_leg.id AS "travelLegId",
        next_leg.name AS "travelLegName",
        next_leg.color AS "travelLegColor",
        primary_contact.first_name AS "primaryContactFirstName",
        primary_contact.last_name AS "primaryContactLastName"
      FROM ${organizations} AS child
      LEFT JOIN LATERAL (
        SELECT
          candidate.id,
          candidate.kind,
          candidate.due_at
        FROM ${followUps} AS candidate
        WHERE candidate.completed_at IS NULL
          AND (
            candidate.organization_id = child.id
            OR EXISTS (
              SELECT 1
              FROM ${organizationContacts} AS association
              WHERE association.organization_id = child.id
                AND association.active
                AND association.contact_id = candidate.contact_id
            )
            OR EXISTS (
              SELECT 1
              FROM ${bookings} AS related_booking
              WHERE related_booking.organization_id = child.id
                AND related_booking.id = candidate.booking_id
            )
          )
        ORDER BY candidate.due_at, candidate.id
        LIMIT 1
      ) AS next_follow_up ON true
      LEFT JOIN LATERAL (
        SELECT
          candidate.id,
          candidate.name,
          candidate.starts_at,
          candidate.status,
          candidate.travel_leg_id
        FROM ${bookings} AS candidate
        WHERE candidate.organization_id = child.id
          AND candidate.starts_at >= now()
        ORDER BY candidate.starts_at, candidate.id
        LIMIT 1
      ) AS next_booking ON true
      LEFT JOIN ${travelLegs} AS next_leg
        ON next_leg.id = next_booking.travel_leg_id
      LEFT JOIN LATERAL (
        SELECT person.first_name, person.last_name
        FROM ${organizationContacts} AS association
        INNER JOIN ${contacts} AS person ON person.id = association.contact_id
        WHERE association.organization_id = child.id
          AND association.active
          AND association.is_primary
        ORDER BY association.updated_at DESC, association.id
        LIMIT 1
      ) AS primary_contact ON true
      WHERE child.parent_organization_id = ${organization.id}
      ORDER BY child.name, child.id
    `),
    database.execute<Omit<OrganizationHierarchyRollups, "travelLegs">>(sql`
      SELECT
        count(*)::int AS "locationCount",
        (
          SELECT count(*)::int
          FROM ${bookings} AS candidate
          INNER JOIN ${organizations} AS booking_location
            ON booking_location.id = candidate.organization_id
          WHERE booking_location.parent_organization_id = ${organization.id}
            AND candidate.starts_at >= now()
        ) AS "upcomingBookingCount",
        (
          SELECT count(*)::int
          FROM ${followUps} AS candidate
          WHERE candidate.completed_at IS NULL
            AND candidate.due_at < now()
            AND (
              EXISTS (
                SELECT 1
                FROM ${organizations} AS direct_location
                WHERE direct_location.parent_organization_id = ${organization.id}
                  AND direct_location.id = candidate.organization_id
              )
              OR EXISTS (
                SELECT 1
                FROM ${organizationContacts} AS association
                INNER JOIN ${organizations} AS contact_location
                  ON contact_location.id = association.organization_id
                WHERE contact_location.parent_organization_id = ${organization.id}
                  AND association.active
                  AND association.contact_id = candidate.contact_id
              )
              OR EXISTS (
                SELECT 1
                FROM ${bookings} AS related_booking
                INNER JOIN ${organizations} AS booking_location
                  ON booking_location.id = related_booking.organization_id
                WHERE booking_location.parent_organization_id = ${organization.id}
                  AND related_booking.id = candidate.booking_id
              )
            )
        ) AS "overdueFollowUpCount",
        (
          SELECT max(candidate.timeline_sort_at)
          FROM ${activities} AS candidate
          WHERE candidate.kind = 'call'
            AND (
              EXISTS (
                SELECT 1
                FROM ${organizations} AS direct_location
                WHERE direct_location.parent_organization_id = ${organization.id}
                  AND direct_location.id = candidate.organization_id
              )
              OR EXISTS (
                SELECT 1
                FROM ${organizationContacts} AS association
                INNER JOIN ${organizations} AS contact_location
                  ON contact_location.id = association.organization_id
                WHERE contact_location.parent_organization_id = ${organization.id}
                  AND association.active
                  AND association.contact_id = candidate.contact_id
              )
              OR EXISTS (
                SELECT 1
                FROM ${bookings} AS related_booking
                INNER JOIN ${organizations} AS booking_location
                  ON booking_location.id = related_booking.organization_id
                WHERE booking_location.parent_organization_id = ${organization.id}
                  AND related_booking.id = candidate.booking_id
              )
            )
        ) AS "mostRecentContactAt"
      FROM ${organizations} AS child
      WHERE child.parent_organization_id = ${organization.id}
    `),
    database.execute<OrganizationHierarchyRollups["travelLegs"][number]>(sql`
      SELECT DISTINCT leg.id, leg.name, leg.color
      FROM ${organizations} AS child
      INNER JOIN ${bookings} AS child_booking
        ON child_booking.organization_id = child.id
      INNER JOIN ${travelLegs} AS leg
        ON leg.id = child_booking.travel_leg_id
      WHERE child.parent_organization_id = ${organization.id}
      ORDER BY leg.name, leg.id
    `),
  ]);

  return assembleOrganizationHierarchy(
    null,
    [...locationResult.rows],
    rollupResult.rows[0] ?? emptyHierarchyRollupRecord,
    [...travelLegResult.rows],
  );
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

    const [organizationPeople, organizationBookings, hierarchy] = await Promise.all([
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
      loadOrganizationHierarchySummary(this.database, organization),
    ]);

    return {
      id: organization.id,
      name: organization.name,
      lastResort: organization.lastResort,
      lastResortReason: organization.lastResortReason,
      lastResortChangedAt: organization.lastResortChangedAt,
      ...hierarchy,
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
