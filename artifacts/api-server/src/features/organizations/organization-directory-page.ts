import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { db as database } from "../../db/client";
import {
  bookings,
  contacts,
  eventFamilyMembers,
  followUps,
  eventDateFacts,
  organizationContacts,
  organizationLocations,
  organizations,
} from "../../db/schema";
import { resolveEffectiveEventDate } from "../event-date-coverage/effective-event-date";
import type { EffectiveEventDate } from "../event-date-coverage/event-date-types";
import type { OrganizationListQuery } from "./last-resort-input";

type MatchedOrganizationLocation = {
  id: string;
  label: string;
  city: string | null;
  region: string | null;
};

type FillerProfileRow = {
  id: string;
  filler: boolean;
  fillerReason: string | null;
  fillerChangedAt: Date | null;
};
type DecisionProfileRow = {
  id: string; nextEventDate: Date | null; applicationDeadline: string | null;
  recommendedDealModel: "flat_fee" | "pay_per_play" | "either" | null;
  pipelineStatus: string | null; priority: string | null;
  nextActionKind: string | null; nextActionDueAt: Date | null;
  deadlineSoon: boolean; booked: boolean;
};

type OrganizationListPage = {
  records: Array<{
    id: string;
    name: string;
    city: string | null;
    region: string | null;
    lastResort: boolean;
    lastResortReason: string | null;
    lastResortChangedAt: Date | null;
    filler: boolean;
    fillerReason: string | null;
    fillerChangedAt: Date | null;
    contactCount: number;
    bookingCount: number;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
    effectiveEventDate: EffectiveEventDate | null;
    nextEventDate: Date | null;
    applicationDeadline: string | null;
    pipelineStatus: string | null;
    priority: string | null;
    decisionStatus: "deadline_soon" | "needs_follow_up" | "contacted" | "waiting" | "booked" | "not_a_fit" | "unrecorded";
    recommendedDealModel: "flat_fee" | "pay_per_play" | "either" | null;
    nextActionKind: string | null;
    nextActionDueAt: Date | null;
    locationCount: number;
    matchedLocation: MatchedOrganizationLocation | null;
    parentContext:
      | { kind: "organization_group"; id: string; name: string }
      | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function buildDirectoryCondition(query: OrganizationListQuery): SQL | undefined {
  const pattern = `%${query.search}%`;
  const notRetiredCondition =
    query.includeRetired || query.showMembers || Boolean(query.search)
      ? undefined
      : isNull(organizations.consolidatedIntoId);

  const searchCondition = query.search
    ? sql`(
        ${organizations.name} ilike ${pattern}
        or ${organizations.city} ilike ${pattern}
        or ${organizations.phone} ilike ${pattern}
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
          from ${organizationLocations} as loc
          where loc.organization_id = ${organizations.id}
            and (
              loc.label ilike ${pattern}
              or loc.venue_name ilike ${pattern}
              or loc.city ilike ${pattern}
              or loc.region ilike ${pattern}
              or loc.postal_code ilike ${pattern}
              or loc.address_1 ilike ${pattern}
              or loc.website ilike ${pattern}
              or loc.phone ilike ${pattern}
              or loc.email ilike ${pattern}
              or exists (
                select 1
                from ${contacts} as loc_contact
                where loc_contact.organization_location_id = loc.id
                  and (
                    loc_contact.first_name ilike ${pattern}
                    or loc_contact.last_name ilike ${pattern}
                    or concat_ws(' ', loc_contact.first_name, loc_contact.last_name) ilike ${pattern}
                    or loc_contact.phone ilike ${pattern}
                    or loc_contact.email ilike ${pattern}
                  )
              )
            )
        )
      )`
    : undefined;

  const lastResortCondition = query.lastResort === "only" ? eq(organizations.lastResort, true) : undefined;
  const fillerCondition = query.filler === "only" ? sql.raw("filler = true") : undefined;
  const travelLegCondition = query.travelLegId
    ? sql`exists (select 1 from ${bookings} where ${bookings.organizationId} = ${organizations.id} and ${bookings.travelLegId} = ${query.travelLegId})`
    : undefined;
  const typeCondition = query.placeType ? sql`${organizations.placeType} = ${query.placeType}` : undefined;
  const regionCondition = query.region ? sql`lower(${organizations.region}) = lower(${query.region})` : undefined;
  const phoneCondition = query.hasPhone
    ? sql`exists (select 1 from ${organizationContacts} oc inner join ${contacts} c on c.id = oc.contact_id where oc.organization_id = ${organizations.id} and oc.active and c.phone is not null and btrim(c.phone) <> '')`
    : undefined;
  const emailCondition = query.hasEmail
    ? sql`exists (select 1 from ${organizationContacts} oc inner join ${contacts} c on c.id = oc.contact_id where oc.organization_id = ${organizations.id} and oc.active and c.email is not null and btrim(c.email) <> '')`
    : undefined;
  const followUpCondition = query.hasFollowUp
    ? sql`exists (select 1 from ${followUps} f where f.organization_id = ${organizations.id} or f.contact_id in (select oc.contact_id from ${organizationContacts} oc where oc.organization_id = ${organizations.id} and oc.active))`
    : undefined;
  const bookingCondition = query.hasBooking
    ? sql`exists (
        select 1 from ${bookings} b
        where b.organization_id = ${organizations.id}
          and coalesce(b.notes, '') not like '[Merged duplicate] Canonical booking:%'
      )`
    : undefined;
  const locationCondition = query.hasLocations
    ? sql`exists (select 1 from ${organizationLocations} l where l.organization_id = ${organizations.id})`
    : undefined;
  const familyMemberCondition = query.showMembers || Boolean(query.search)
    ? undefined
    : sql`not exists (select 1 from ${eventFamilyMembers} efm where efm.organization_id = ${organizations.id})`;
  const quickCondition = (() => {
    switch (query.quickFilter) {
      case "deadline_soon": return sql`${organizations.applicationDeadline} between current_date and current_date + 30`;
      case "pay_per_play": return eq(organizations.recommendedDealModel, "pay_per_play");
      case "needs_follow_up": return sql`(
        exists (select 1 from follow_ups f where f.completed_at is null and (
          f.organization_id = ${organizations.id}
          or (f.organization_id is null and f.booking_id in (select b.id from bookings b where b.organization_id = ${organizations.id}))
          or (f.organization_id is null and f.booking_id is null and f.contact_id in (select oc.contact_id from organization_contacts oc where oc.organization_id = ${organizations.id} and oc.active))
        ))
        or exists (
          select 1 from booking_opportunities bo
          where bo.organization_id = ${organizations.id}
            and bo.next_action_due_at is not null
            and bo.status not in ('booked','not_pursuing','declined','cancelled')
            and not exists (
              select 1 from booking_opportunities newer
              where newer.organization_id = bo.organization_id
                and (newer.event_year, newer.updated_at, newer.id) > (bo.event_year, bo.updated_at, bo.id)
            )
        )
      )`;
      case "booked": return sql`(
        exists (select 1 from bookings b where b.organization_id = ${organizations.id} and b.status = 'confirmed'
          and coalesce(b.ends_at, b.starts_at) >= now()
          and coalesce(b.notes, '') not like '[Merged duplicate] Canonical booking:%')
        or exists (
          select 1 from booking_opportunities bo
          where bo.organization_id = ${organizations.id} and bo.status = 'booked'
            and not exists (
              select 1 from booking_opportunities newer
              where newer.organization_id = bo.organization_id
                and (newer.event_year, newer.updated_at, newer.id) > (bo.event_year, bo.updated_at, bo.id)
            )
        )
      )`;
      default: return undefined;
    }
  })();

  return and(
    searchCondition,
    notRetiredCondition,
    lastResortCondition,
    fillerCondition,
    travelLegCondition,
    typeCondition,
    regionCondition,
    phoneCondition,
    emailCondition,
    followUpCondition,
    bookingCondition,
    locationCondition,
    familyMemberCondition,
    quickCondition,
  ) ?? undefined;
}

export function profileLastChangedAtSql(): SQL {
  return sql`coalesce(${sql.raw('"organizations"."last_worked_at"')}, ${organizations.createdAt})`;
}

export function buildOrganizationDirectoryOrderBy(query: OrganizationListQuery): SQL[] {
  const exactMatch = query.search
    ? sql`case when lower(${organizations.name}) = lower(${query.search}) then 0 else 1 end`
    : null;
  const recency = profileLastChangedAtSql();
  const fillerPriority = sql.raw('case when coalesce("organizations"."filler", false) then 1 else 0 end');

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
        return [asc(fillerPriority), desc(recency), asc(organizations.name), asc(organizations.id)];
    }
  })();

  return exactMatch ? [exactMatch, ...sortOrder] : sortOrder;
}

export async function listOrganizationDirectoryPage(
  db: typeof database,
  query: OrganizationListQuery,
): Promise<OrganizationListPage> {
  const condition = buildDirectoryCondition(query);
  const [totals] = await db.select({ value: count() }).from(organizations).where(condition);
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
  const idList = sql.join(organizationIds.map((id) => sql`${id}::uuid`), sql.raw(", "));
  const fillerResult = await db.execute<FillerProfileRow>(sql`
    select
      id,
      coalesce(filler, false) as filler,
      filler_reason as "fillerReason",
      filler_changed_at as "fillerChangedAt"
    from organizations
    where id in (${idList})
  `);
  const fillerByOrganization = new Map((fillerResult.rows ?? []).map((row) => [row.id, row]));

  const parentIds = [...new Set(
    organizationRecords
      .map((organization) => organization.consolidatedIntoId)
      .filter((id): id is string => Boolean(id)),
  )];
  const parentRows = parentIds.length
    ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, parentIds))
    : [];
  const parentNameById = new Map(parentRows.map((row) => [row.id, row.name]));
  const locationSearchPattern = query.search ? `%${query.search}%` : null;

  const [contactCounts, bookingCounts, primaryContacts, locationCounts, matchedLocationRows] = await Promise.all([
    db
      .select({ organizationId: organizationContacts.organizationId, value: count() })
      .from(organizationContacts)
      .where(and(
        inArray(organizationContacts.organizationId, organizationIds),
        eq(organizationContacts.active, true),
        sql`not exists (
          select 1 from contact_consolidations cc
          where cc.source_contact_id = ${organizationContacts.contactId}
        )`,
      ))
      .groupBy(organizationContacts.organizationId),
    db
      .select({ organizationId: bookings.organizationId, value: count() })
      .from(bookings)
      .where(and(
        inArray(bookings.organizationId, organizationIds),
        sql`coalesce(${bookings.notes}, '') not like '[Merged duplicate] Canonical booking:%'`,
      ))
      .groupBy(bookings.organizationId),
    db
      .select({ organizationId: organizationContacts.organizationId, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone })
      .from(organizationContacts)
      .innerJoin(contacts, eq(organizationContacts.contactId, contacts.id))
      .where(and(
        inArray(organizationContacts.organizationId, organizationIds),
        eq(organizationContacts.active, true),
        eq(organizationContacts.isPrimary, true),
        sql`not exists (
          select 1 from contact_consolidations cc
          where cc.source_contact_id = ${organizationContacts.contactId}
        )`,
      )),
    db
      .select({ organizationId: organizationLocations.organizationId, value: count() })
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

  const decisionResult = await db.execute<DecisionProfileRow>(sql`
    select o.id,
      (select min(b.starts_at) from bookings b
       where b.organization_id = o.id and b.starts_at >= now()
         and b.status not in ('declined','cancelled')
         and coalesce(b.notes, '') not like '[Merged duplicate] Canonical booking:%') as "nextEventDate",
      o.application_deadline as "applicationDeadline",
      o.recommended_deal_model as "recommendedDealModel",
      opportunity.status as "pipelineStatus", opportunity.priority,
      case when opportunity.next_action_due_at is null then followup.due_at
           when followup.due_at is null then opportunity.next_action_due_at
           when opportunity.next_action_due_at <= followup.due_at then opportunity.next_action_due_at
           else followup.due_at end as "nextActionDueAt",
      case when opportunity.next_action_due_at is null then followup.kind
           when followup.due_at is null then opportunity.next_action_kind
           when opportunity.next_action_due_at <= followup.due_at then opportunity.next_action_kind
           else followup.kind end as "nextActionKind",
      (o.application_deadline between current_date and current_date + 30) as "deadlineSoon",
      (coalesce(opportunity.status = 'booked', false) or exists (
        select 1 from bookings booked where booked.organization_id = o.id and booked.status = 'confirmed'
          and coalesce(booked.ends_at, booked.starts_at) >= now()
          and coalesce(booked.notes, '') not like '[Merged duplicate] Canonical booking:%'
      )) as booked
    from organizations o
    left join lateral (
      select bo.status, bo.priority, bo.next_action_kind, bo.next_action_due_at
      from booking_opportunities bo where bo.organization_id = o.id
      order by bo.event_year desc, bo.updated_at desc, bo.id desc limit 1
    ) opportunity on true
    left join lateral (
      select f.kind, f.due_at from follow_ups f
      where f.completed_at is null and (
        f.organization_id = o.id
        or (f.organization_id is null and f.booking_id in (select b.id from bookings b where b.organization_id = o.id))
        or (f.organization_id is null and f.booking_id is null and f.contact_id in (select oc.contact_id from organization_contacts oc where oc.organization_id = o.id and oc.active))
      ) order by f.due_at asc limit 1
    ) followup on true
    where o.id in (${idList})
  `);

  const [dateBookings, dateFacts] = await Promise.all([
    db.select({ id: bookings.id, organizationId: bookings.organizationId, startsAt: bookings.startsAt, endsAt: bookings.endsAt, status: bookings.status })
      .from(bookings).where(inArray(bookings.organizationId, organizationIds)),
    db.select().from(eventDateFacts).where(and(inArray(eventDateFacts.organizationId, organizationIds), eq(eventDateFacts.active, true))),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const contactCountByOrganization = new Map(contactCounts.map((record) => [record.organizationId, record.value]));
  const bookingCountByOrganization = new Map(
    bookingCounts.filter((record) => record.organizationId !== null).map((record) => [record.organizationId!, record.value]),
  );
  const primaryContactByOrganization = new Map(
    primaryContacts.map((record) => [record.organizationId, { name: `${record.firstName} ${record.lastName}`.trim(), email: record.email, phone: record.phone }]),
  );
  const decisionsByOrganization = new Map((decisionResult.rows ?? []).map((row) => [row.id, row]));
  const locationCountByOrganization = new Map(locationCounts.map((record) => [record.organizationId, record.value]));
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
    records: organizationRecords.map((organization) => {
      const filler = fillerByOrganization.get(organization.id);
      const contact = primaryContactByOrganization.get(organization.id);
      const decision = decisionsByOrganization.get(organization.id);
      const pipeline = decision?.pipelineStatus ?? null;
      const decisionStatus = (["not_pursuing", "declined", "cancelled"].includes(pipeline ?? "")
        ? "not_a_fit" : decision?.booked ? "booked" : decision?.deadlineSoon ? "deadline_soon"
        : decision?.nextActionDueAt ? "needs_follow_up"
        : ["contacted", "follow_up", "interested", "booking_in_progress"].includes(pipeline ?? "") ? "contacted"
        : ["new_lead", "researching", "ready_to_contact", "no_response", "territory_hold", "needs_review"].includes(pipeline ?? "") ? "waiting"
        : "unrecorded") as OrganizationListPage["records"][number]["decisionStatus"];
      return {
        id: organization.id,
        name: organization.name,
        city: organization.city,
        region: organization.region,
        lastResort: organization.lastResort,
        lastResortReason: organization.lastResortReason,
        lastResortChangedAt: organization.lastResortChangedAt,
        filler: filler?.filler ?? false,
        fillerReason: filler?.fillerReason ?? null,
        fillerChangedAt: filler?.fillerChangedAt ?? null,
        contactCount: contactCountByOrganization.get(organization.id) ?? 0,
        bookingCount: bookingCountByOrganization.get(organization.id) ?? 0,
        primaryContactName: contact?.name ?? null,
        primaryContactEmail: contact?.email ?? null,
        primaryContactPhone: contact?.phone ?? null,
        effectiveEventDate: resolveEffectiveEventDate({
          today,
          bookings: dateBookings.filter((booking) => booking.organizationId === organization.id).map((booking) => ({
            id: booking.id, startsOn: booking.startsAt?.toISOString().slice(0, 10) ?? null,
            endsOn: booking.endsAt?.toISOString().slice(0, 10) ?? null, status: booking.status,
          })),
          facts: dateFacts.filter((fact) => fact.organizationId === organization.id),
        }),
        nextEventDate: decision?.nextEventDate ?? null,
        applicationDeadline: decision?.applicationDeadline ?? null,
        pipelineStatus: pipeline,
        priority: decision?.priority ?? null,
        decisionStatus,
        recommendedDealModel: decision?.recommendedDealModel ?? null,
        nextActionKind: decision?.nextActionKind ?? null,
        nextActionDueAt: decision?.nextActionDueAt ?? null,
        locationCount: locationCountByOrganization.get(organization.id) ?? 0,
        matchedLocation: matchedLocationByOrganization.get(organization.id) ?? null,
        parentContext: organization.consolidatedIntoId
          ? {
              kind: "organization_group" as const,
              id: organization.consolidatedIntoId,
              name: parentNameById.get(organization.consolidatedIntoId) ?? "Parent profile",
            }
          : null,
      };
    }),
    total,
    page,
    pageSize: query.pageSize,
    pageCount,
  };
}
