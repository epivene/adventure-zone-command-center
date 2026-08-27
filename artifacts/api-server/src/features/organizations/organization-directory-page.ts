import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { db as database } from "../../db/client";
import {
  bookings,
  contacts,
  organizationContacts,
  organizationLocations,
  organizations,
} from "../../db/schema";
import type { OrganizationListQuery } from "./last-resort-input";
import {
  buildOrganizationListCondition,
  type MatchedOrganizationLocation,
  type OrganizationListPage,
} from "./organization-repository";

export function profileLastChangedAtSql(): SQL {
  return sql`greatest(
    coalesce(${organizations.updatedAt}, ${organizations.createdAt}),
    coalesce((
      select max(c.updated_at)
      from organization_contacts oc
      inner join contacts c on c.id = oc.contact_id
      where oc.organization_id = ${organizations.id}
        and oc.active = true
    ), ${organizations.createdAt}),
    coalesce((
      select max(b.updated_at)
      from bookings b
      where b.organization_id = ${organizations.id}
    ), ${organizations.createdAt}),
    coalesce((
      select max(f.updated_at)
      from follow_ups f
      where f.organization_id = ${organizations.id}
        or f.contact_id in (
          select oc2.contact_id
          from organization_contacts oc2
          where oc2.organization_id = ${organizations.id}
            and oc2.active = true
        )
    ), ${organizations.createdAt}),
    coalesce((
      select max(a.updated_at)
      from activities a
      where a.organization_id = ${organizations.id}
        or a.booking_id in (
          select b2.id
          from bookings b2
          where b2.organization_id = ${organizations.id}
        )
        or a.contact_id in (
          select oc3.contact_id
          from organization_contacts oc3
          where oc3.organization_id = ${organizations.id}
            and oc3.active = true
        )
    ), ${organizations.createdAt})
  )`;
}

export function buildOrganizationDirectoryOrderBy(query: OrganizationListQuery): SQL[] {
  const exactMatch = query.search
    ? sql`case when lower(${organizations.name}) = lower(${query.search}) then 0 else 1 end`
    : null;
  const recency = profileLastChangedAtSql();

  const sortOrder: SQL[] = (() => {
    switch (query.sort) {
      case "least_recently_updated":
        return [asc(recency), asc(organizations.name), asc(organizations.id)];
      case "name_asc":
        return [asc(organizations.name), asc(organizations.id)];
      case "name_desc":
        return [desc(organizations.name), asc(organizations.id)];
      case "created_desc":
        return [desc(organizations.createdAt), asc(organizations.name), asc(organizations.id)];
      case "created_asc":
        return [asc(organizations.createdAt), asc(organizations.name), asc(organizations.id)];
      case "recently_updated":
      default:
        return [desc(recency), asc(organizations.name), asc(organizations.id)];
    }
  })();

  return exactMatch ? [exactMatch, ...sortOrder] : sortOrder;
}

export async function listOrganizationDirectoryPage(
  db: typeof database,
  query: OrganizationListQuery,
): Promise<OrganizationListPage> {
  const condition = buildOrganizationListCondition(query);
  const [totals] = await db
    .select({ value: count() })
    .from(organizations)
    .where(condition);
  const total = totals?.value ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);

  const organizationRecords = await db
    .select()
    .from(organizations)
    .where(condition)
    .orderBy(...buildOrganizationDirectoryOrderBy(query))
    .limit(query.pageSize)
    .offset((page - 1) * query.pageSize);

  if (!organizationRecords.length) {
    return { records: [], total, page, pageSize: query.pageSize, pageCount };
  }

  const organizationIds = organizationRecords.map((organization) => organization.id);
  const parentIds = [...new Set(
    organizationRecords
      .map((organization) => organization.consolidatedIntoId)
      .filter((id): id is string => Boolean(id)),
  )];
  const parentRows = parentIds.length
    ? await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(inArray(organizations.id, parentIds))
    : [];
  const parentNameById = new Map(parentRows.map((row) => [row.id, row.name]));
  const locationSearchPattern = query.search ? `%${query.search}%` : null;

  const [
    contactCounts,
    bookingCounts,
    primaryContacts,
    locationCounts,
    matchedLocationRows,
  ] = await Promise.all([
    db
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
    db
      .select({
        organizationId: bookings.organizationId,
        value: count(),
      })
      .from(bookings)
      .where(inArray(bookings.organizationId, organizationIds))
      .groupBy(bookings.organizationId),
    db
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
    db
      .select({
        organizationId: organizationLocations.organizationId,
        value: count(),
      })
      .from(organizationLocations)
      .where(inArray(organizationLocations.organizationId, organizationIds))
      .groupBy(organizationLocations.organizationId),
    locationSearchPattern
      ? db
          .select({
            organizationId: organizationLocations.organizationId,
            id: organizationLocations.id,
            label: organizationLocations.label,
            city: organizationLocations.city,
            region: organizationLocations.region,
          })
          .from(organizationLocations)
          .where(and(
            inArray(organizationLocations.organizationId, organizationIds),
            sql`(
              ${organizationLocations.label} ilike ${locationSearchPattern}
              or ${organizationLocations.venueName} ilike ${locationSearchPattern}
              or ${organizationLocations.city} ilike ${locationSearchPattern}
              or ${organizationLocations.region} ilike ${locationSearchPattern}
              or ${organizationLocations.postalCode} ilike ${locationSearchPattern}
              or ${organizationLocations.address1} ilike ${locationSearchPattern}
              or ${organizationLocations.website} ilike ${locationSearchPattern}
              or ${organizationLocations.phone} ilike ${locationSearchPattern}
              or ${organizationLocations.email} ilike ${locationSearchPattern}
              or exists (
                select 1 from ${contacts} as loc_contact
                where loc_contact.organization_location_id = ${organizationLocations.id}
                  and (
                    loc_contact.first_name ilike ${locationSearchPattern}
                    or loc_contact.last_name ilike ${locationSearchPattern}
                    or concat_ws(' ', loc_contact.first_name, loc_contact.last_name) ilike ${locationSearchPattern}
                    or loc_contact.phone ilike ${locationSearchPattern}
                    or loc_contact.email ilike ${locationSearchPattern}
                  )
              )
            )`,
          ))
      : Promise.resolve([] as {
          organizationId: string;
          id: string;
          label: string;
          city: string | null;
          region: string | null;
        }[]),
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
  const locationCountByOrganization = new Map(
    locationCounts.map((record) => [record.organizationId, record.value]),
  );
  const matchedLocationByOrganization = new Map<string, MatchedOrganizationLocation>();
  for (const row of matchedLocationRows) {
    if (!matchedLocationByOrganization.has(row.organizationId)) {
      matchedLocationByOrganization.set(row.organizationId, {
        id: row.id,
        label: row.label,
        city: row.city,
        region: row.region,
      });
    }
  }

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
      locationCount: locationCountByOrganization.get(organization.id) ?? 0,
      matchedLocation: matchedLocationByOrganization.get(organization.id) ?? null,
      parentContext: organization.consolidatedIntoId
        ? {
            kind: "organization_group" as const,
            id: organization.consolidatedIntoId,
            name: parentNameById.get(organization.consolidatedIntoId) ?? "Parent profile",
          }
        : null,
    })),
    total,
    page,
    pageSize: query.pageSize,
    pageCount,
  };
}
