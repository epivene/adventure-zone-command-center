import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import type { OrganizationListQuery } from "@/features/organizations/last-resort-input";
import { listOrganizationDirectoryPage } from "@/features/organizations/organization-directory-page";
import { attachEventFamiliesToOrganizationPage } from "@/features/event-families/event-family-list";
import { loadProfileCardDetailsWith } from "@/features/organizations/profile-card-details";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";

export async function listBossProfileDirectory(db: typeof database, query: OrganizationListQuery) {
  const page = await listOrganizationDirectoryPage(db, query);
  const details = await loadProfileCardDetailsWith(page.records.map((row) => row.id), (statement) => db.execute(statement as any));
  const enriched = { ...page, records: page.records.map((row) => ({ ...row, ...details.get(row.id) })) };
  const [grouped, legs] = await Promise.all([
    attachEventFamiliesToOrganizationPage(db, query, enriched),
    new DrizzleTravelLegRepository(db).listTravelLegs(),
  ]);
  return {
    ...grouped.organizations,
    // Allow-list the shared card facts; private strategy/provenance is not projected.
    records: page.records.map((row) => ({
      id: row.id, name: row.name, city: row.city, region: row.region,
      contactCount: row.contactCount, bookingCount: row.bookingCount, locationCount: row.locationCount,
      primaryContactName: row.primaryContactName,
      applicationDeadline: row.applicationDeadline,
      recommendedDealModel: row.recommendedDealModel,
      effectiveEventDate: row.effectiveEventDate,
      decisionStatus: row.decisionStatus, pipelineStatus: row.pipelineStatus, priority: row.priority,
      nextActionKind: row.nextActionKind, nextActionDueAt: row.nextActionDueAt,
      ratingAverage: details.get(row.id)?.ratingAverage ?? null, ratingCount: details.get(row.id)?.ratingCount ?? 0,
    })),
    families: grouped.families.map((family) => ({
      id: family.id, name: family.name, memberCount: family.memberCount,
    })),
    travelLegs: legs.map((leg) => ({ id: leg.id, name: leg.name, color: leg.color })),
  };
}

export function projectBossGlance(profile: EventProfile, decisionSummary: {
  priority: string | null; pipelineStatus: string | null;
  nextActionKind: string | null; nextActionDueAt: Date | string | null;
}) {
  return {
    place: {
      name: profile.place.name,
      applicationDeadline: profile.place.applicationDeadline ?? null,
      recommendedDealModel: profile.place.recommendedDealModel ?? null,
    },
    effectiveEventDate: profile.effectiveEventDate,
    eventDateFacts: profile.eventDateFacts.filter((fact) => fact.active).map((fact) => ({
      id: fact.id, startsOn: fact.startsOn, status: fact.status,
      sourceTitle: fact.sourceTitle, sourceUrl: fact.sourceUrl,
    })),
    decisionSummary,
  };
}

export async function loadBossGlance(db: typeof database, profile: EventProfile) {
  const result = await db.execute<{
    priority: string | null; pipelineStatus: string | null;
    nextActionKind: string | null; nextActionDueAt: Date | null;
  }>(sql`
    select opportunity.priority, opportunity.status as "pipelineStatus",
      case when opportunity.next_action_due_at is null then followup.due_at
           when followup.due_at is null then opportunity.next_action_due_at
           when opportunity.next_action_due_at <= followup.due_at then opportunity.next_action_due_at
           else followup.due_at end as "nextActionDueAt",
      case when opportunity.next_action_due_at is null then followup.kind
           when followup.due_at is null then opportunity.next_action_kind
           when opportunity.next_action_due_at <= followup.due_at then opportunity.next_action_kind
           else followup.kind end as "nextActionKind"
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
        or (f.organization_id is null and f.booking_id is null and f.contact_id in
          (select oc.contact_id from organization_contacts oc where oc.organization_id = o.id and oc.active))
      ) order by f.due_at asc limit 1
    ) followup on true
    where o.id = ${profile.id}::uuid
  `);
  const decision = result.rows?.[0];
  const nextBooking = profile.bookings.filter((row) => row.startsAt && row.startsAt.getTime() >= Date.now()
    && !["declined", "cancelled"].includes(row.status)).sort((a, b) => Number(a.startsAt) - Number(b.startsAt))[0];
  return projectBossGlance(profile, {
    priority: decision?.priority ?? nextBooking?.probability ?? null,
    pipelineStatus: decision?.pipelineStatus ?? nextBooking?.status ?? null,
    nextActionKind: decision?.nextActionKind ?? null,
    nextActionDueAt: decision?.nextActionDueAt ?? null,
  });
}
