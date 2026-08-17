import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  eventFamilies,
  eventFamilyMembers,
  organizations,
} from "@/db/schema";
import {
  buildOrganizationListCondition,
  type OrganizationListPage,
  type OrganizationListQuery,
} from "@/features/organizations/organization-repository";
import { activeProfileIdSet } from "@/features/record-lifecycle/active-profile";

export type EventFamilyListRecord = {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  matchedMemberCount: number;
  memberCount: number;
};

export async function attachEventFamiliesToOrganizationPage(
  db: typeof database,
  query: OrganizationListQuery,
  page: OrganizationListPage,
): Promise<{
  organizations: OrganizationListPage & {
    records: Array<OrganizationListPage["records"][number] & { eventFamilyId: string | null }>;
  };
  families: EventFamilyListRecord[];
}> {
  const condition = buildOrganizationListCondition(query, { includeEventFamilyMembers: true });
  const liveCondition = and(condition, sql`${organizations}.archived_at is null`);
  const activeIds = await activeProfileIdSet(db, page.records.map((record) => record.id));
  const activeRecords = page.records.filter((record) => activeIds.has(record.id));

  const matchedFamilies = await db
    .select({
      id: eventFamilies.id,
      name: eventFamilies.name,
      normalizedName: eventFamilies.normalizedName,
      description: eventFamilies.description,
      matchedMemberCount: count(eventFamilyMembers.organizationId),
    })
    .from(eventFamilyMembers)
    .innerJoin(eventFamilies, eq(eventFamilies.id, eventFamilyMembers.familyId))
    .innerJoin(organizations, eq(organizations.id, eventFamilyMembers.organizationId))
    .where(liveCondition)
    .groupBy(
      eventFamilies.id,
      eventFamilies.name,
      eventFamilies.normalizedName,
      eventFamilies.description,
    )
    .orderBy(eventFamilies.name);

  const familyIds = matchedFamilies.map((family) => family.id);
  const totalCounts = familyIds.length
    ? await db
        .select({ familyId: eventFamilyMembers.familyId, value: count() })
        .from(eventFamilyMembers)
        .innerJoin(organizations, eq(organizations.id, eventFamilyMembers.organizationId))
        .where(and(
          inArray(eventFamilyMembers.familyId, familyIds),
          sql`${organizations}.archived_at is null`,
        ))
        .groupBy(eventFamilyMembers.familyId)
    : [];
  const totalByFamily = new Map(totalCounts.map((row) => [row.familyId, row.value]));

  const pageOrganizationIds = activeRecords.map((record) => record.id);
  const pageMemberships = pageOrganizationIds.length
    ? await db
        .select({
          organizationId: eventFamilyMembers.organizationId,
          familyId: eventFamilyMembers.familyId,
          familyName: eventFamilies.name,
        })
        .from(eventFamilyMembers)
        .innerJoin(eventFamilies, eq(eventFamilies.id, eventFamilyMembers.familyId))
        .where(inArray(eventFamilyMembers.organizationId, pageOrganizationIds))
    : [];
  const familyByOrganization = new Map(
    pageMemberships.map((membership) => [membership.organizationId, membership]),
  );

  return {
    organizations: {
      ...page,
      records: activeRecords.map((record) => {
        const membership = familyByOrganization.get(record.id);
        return {
          ...record,
          eventFamilyId: membership?.familyId ?? null,
          parentContext: record.parentContext ?? (membership
            ? { kind: "event_family" as const, id: membership.familyId, name: membership.familyName }
            : null),
        };
      }),
    },
    families: matchedFamilies.map((family) => ({
      ...family,
      matchedMemberCount: Number(family.matchedMemberCount),
      memberCount: Number(totalByFamily.get(family.id) ?? 0),
    })),
  };
}
