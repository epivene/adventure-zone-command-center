import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  activities,
  bookings,
  contacts,
  followUps,
  organizationContacts,
  organizations,
  travelLegs,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { bookingStatusValues } from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";
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
  /** When true, child/consolidated organizations are included in results. */
  includeRetired?: boolean;
  page: number;
  pageSize: number;
};

export type MatchedOrganizationLocation = {
  id: string;
  label: string;
  city: string | null;
  region: string | null;
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
  parent: OrganizationParentSummary | null;
  locationCount: number;
  /** Present when the search matched via an organization_locations record. */
  matchedLocation?: MatchedOrganizationLocation | null;
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


const activeBookingStatuses = bookingStatusValues.filter(isActiveStatus);

function activeBookingStatusCondition(status: SQLWrapper): SQL {
  return sql`${status} in (${sql.join(
    activeBookingStatuses.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

export function organizationOwnedRecordCondition(
  columns: {
    organizationId: SQLWrapper;
    bookingId: SQLWrapper;
    contactId: SQLWrapper;
  },
  matchesExplicitOrganization: SQL,
  matchesBookingOrganization: SQL,
  matchesContactAssociation: SQL,
): SQL {
  return sql`(
    (${columns.organizationId} is not null and ${matchesExplicitOrganization})
    or (
      ${columns.organizationId} is null
      and ${columns.bookingId} is not null
      and ${matchesBookingOrganization}
    )
    or (
      ${columns.organizationId} is null
      and ${columns.bookingId} is null
      and ${columns.contactId} is not null
      and ${matchesContactAssociation}
    )
  )`;
}

export function organizationHierarchyLocationQuery(parentId: string): SQL {
  return sql`
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
        AND ${organizationOwnedRecordCondition(
          {
            organizationId: sql`candidate.organization_id`,
            bookingId: sql`candidate.booking_id`,
            contactId: sql`candidate.contact_id`,
          },
          sql`candidate.organization_id = child.id`,
          sql`EXISTS (
            SELECT 1
            FROM ${bookings} AS related_booking
            WHERE related_booking.organization_id = child.id
              AND related_booking.id = candidate.booking_id
          )`,
          sql`EXISTS (
            SELECT 1
            FROM ${organizationContacts} AS association
            WHERE association.organization_id = child.id
              AND association.active
              AND association.contact_id = candidate.contact_id
          )`,
        )}
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
        AND ${activeBookingStatusCondition(sql`candidate.status`)}
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
    WHERE child.parent_organization_id = ${parentId}
    ORDER BY child.name, child.id
  `;
}

export function organizationHierarchyRollupQuery(parentId: string): SQL {
  return sql`
    SELECT
      count(*)::int AS "locationCount",
      (
        SELECT count(*)::int
        FROM ${bookings} AS candidate
        INNER JOIN ${organizations} AS booking_location
          ON booking_location.id = candidate.organization_id
        WHERE booking_location.parent_organization_id = ${parentId}
          AND candidate.starts_at >= now()
          AND ${activeBookingStatusCondition(sql`candidate.status`)}
      ) AS "upcomingBookingCount",
      (
        SELECT count(*)::int
        FROM ${followUps} AS candidate
        WHERE candidate.completed_at IS NULL
          AND candidate.due_at < now()
          AND ${organizationOwnedRecordCondition(
            {
              organizationId: sql`candidate.organization_id`,
              bookingId: sql`candidate.booking_id`,
              contactId: sql`candidate.contact_id`,
            },
            sql`EXISTS (
              SELECT 1
              FROM ${organizations} AS direct_location
              WHERE direct_location.parent_organization_id = ${parentId}
                AND direct_location.id = candidate.organization_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${bookings} AS related_booking
              INNER JOIN ${organizations} AS booking_location
                ON booking_location.id = related_booking.organization_id
              WHERE booking_location.parent_organization_id = ${parentId}
                AND related_booking.id = candidate.booking_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${organizationContacts} AS association
              INNER JOIN ${organizations} AS contact_location
                ON contact_location.id = association.organization_id
              WHERE contact_location.parent_organization_id = ${parentId}
                AND association.active
                AND association.contact_id = candidate.contact_id
            )`,
          )}
      ) AS "overdueFollowUpCount",
      (
        SELECT max(candidate.timeline_sort_at)
        FROM ${activities} AS candidate
        WHERE candidate.kind = 'call'
          AND ${organizationOwnedRecordCondition(
            {
              organizationId: sql`candidate.organization_id`,
              bookingId: sql`candidate.booking_id`,
              contactId: sql`candidate.contact_id`,
            },
            sql`EXISTS (
              SELECT 1
              FROM ${organizations} AS direct_location
              WHERE direct_location.parent_organization_id = ${parentId}
                AND direct_location.id = candidate.organization_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${bookings} AS related_booking
              INNER JOIN ${organizations} AS booking_location
                ON booking_location.id = related_booking.organization_id
              WHERE booking_location.parent_organization_id = ${parentId}
                AND related_booking.id = candidate.booking_id
            )`,
            sql`EXISTS (
              SELECT 1
              FROM ${organizationContacts} AS association
              INNER JOIN ${organizations} AS contact_location
                ON contact_location.id = association.organization_id
              WHERE contact_location.parent_organization_id = ${parentId}
                AND association.active
                AND association.contact_id = candidate.contact_id
            )`,
          )}
      ) AS "mostRecentContactAt"
    FROM ${organizations} AS child
    WHERE child.parent_organization_id = ${parentId}
  `;
}

export function organizationHierarchyTravelLegQuery(parentId: string): SQL {
  return sql`
    SELECT DISTINCT leg.id, leg.name, leg.color
    FROM ${organizations} AS child
    INNER JOIN ${bookings} AS child_booking
      ON child_booking.organization_id = child.id
    INNER JOIN ${travelLegs} AS leg
      ON leg.id = child_booking.travel_leg_id
    WHERE child.parent_organization_id = ${parentId}
    ORDER BY leg.name, leg.id
  `;
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
    database.execute<OrganizationLocationAggregateRecord>(
      organizationHierarchyLocationQuery(organization.id),
    ),
    database.execute<Omit<OrganizationHierarchyRollups, "travelLegs">>(
      organizationHierarchyRollupQuery(organization.id),
    ),
    database.execute<OrganizationHierarchyRollups["travelLegs"][number]>(
      organizationHierarchyTravelLegQuery(organization.id),
    ),
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
  const pattern = `%${query.search}%`;
  const searchCondition = query.search
    ? sql`(
        ${organizations.name} ilike ${pattern}
        or ${organizations.city} ilike ${pattern}
        or ${organizations.phone} ilike ${pattern}
        or exists (
          select 1
          from ${organizations} as parent_organization
          where parent_organization.id = ${organizations.parentOrganizationId}
            and parent_organization.name ilike ${pattern}
        )
        or exists (
          select 1
          from ${organizationContacts} as association
          inner join ${contacts} as person
            on person.id = association.contact_id
          where association.organization_id = ${organizations.id}
            and association.active
            and (
              person.first_name ilike ${pattern}
              or person.last_name ilike ${pattern}
              or concat_ws(' ', person.first_name, person.last_name) ilike ${pattern}
              or person.phone ilike ${pattern}
              or person.email ilike ${pattern}
            )
        )
        or exists (
          select 1
          from ${organizations} as child_location
          where child_location.parent_organization_id = ${organizations.id}
            and (
              child_location.name ilike ${pattern}
              or child_location.city ilike ${pattern}
              or child_location.phone ilike ${pattern}
              or exists (
                select 1
                from ${organizationContacts} as child_association
                inner join ${contacts} as child_person
                  on child_person.id = child_association.contact_id
                where child_association.organization_id = child_location.id
                  and child_association.active
                  and (
                    child_person.first_name ilike ${pattern}
                    or child_person.last_name ilike ${pattern}
                    or concat_ws(
                      ' ',
                      child_person.first_name,
                      child_person.last_name
                    ) ilike ${pattern}
                    or child_person.phone ilike ${pattern}
                    or child_person.email ilike ${pattern}
                  )
              )
            )
        )
      )`
    : isNull(organizations.parentOrganizationId);
  const lastResortCondition =
    query.lastResort === "only" ? eq(organizations.lastResort, true) : undefined;
  const travelLegCondition = query.travelLegId
    ? sql`exists (select 1 from ${bookings} where ${bookings.organizationId} = ${organizations.id} and ${bookings.travelLegId} = ${query.travelLegId})`
    : undefined;

  return and(searchCondition, lastResortCondition, travelLegCondition) ?? undefined;
}

export function buildOrganizationListOrderBy(
  query: OrganizationListQuery,
): SQL[] {
  return query.search
    ? [
        sql`case
          when lower(${organizations.name}) = lower(${query.search}) then 0
          when ${organizations.parentOrganizationId} is null then 1
          else 2
        end`,
        asc(organizations.name),
        asc(organizations.id),
      ]
    : [asc(organizations.name), asc(organizations.id)];
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
      .orderBy(...buildOrganizationListOrderBy(query))
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);
    if (!organizationRecords.length) {
      return { records: [], total, page, pageSize: query.pageSize, pageCount };
    }

    const organizationIds = organizationRecords.map((organization) => organization.id);
    const parentIds = [
      ...new Set(
        organizationRecords
          .map((organization) => organization.parentOrganizationId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const [
      contactCounts,
      bookingCounts,
      primaryContacts,
      parentRecords,
      locationCounts,
    ] = await Promise.all([
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
      parentIds.length
        ? this.database
            .select({
              id: organizations.id,
              name: organizations.name,
              website: organizations.website,
            })
            .from(organizations)
            .where(inArray(organizations.id, parentIds))
        : Promise.resolve([] as OrganizationParentSummary[]),
      this.database
        .select({
          parentOrganizationId: organizations.parentOrganizationId,
          value: count(),
        })
        .from(organizations)
        .where(inArray(organizations.parentOrganizationId, organizationIds))
        .groupBy(organizations.parentOrganizationId),
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
    const parentById = new Map(
      parentRecords.map((record) => [record.id, record]),
    );
    const locationCountByParent = new Map(
      locationCounts
        .filter((record) => record.parentOrganizationId !== null)
        .map((record) => [record.parentOrganizationId!, record.value]),
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
        parent: organization.parentOrganizationId
          ? parentById.get(organization.parentOrganizationId) ?? null
          : null,
        locationCount: locationCountByParent.get(organization.id) ?? 0,
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
