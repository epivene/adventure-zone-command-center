import { and, asc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { organizations } from "@/db/schema";

type Database = typeof applicationDatabase;

export type OrganizationMembershipSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

export type OrganizationMembershipCandidate = OrganizationMembershipSummary & {
  currentParent: OrganizationMembershipSummary | null;
};

const summaryFields = {
  id: organizations.id,
  name: organizations.name,
  city: organizations.city,
  region: organizations.region,
};

function searchCondition(query: string) {
  const term = `%${query.trim()}%`;
  return or(
    ilike(organizations.name, term),
    ilike(organizations.city, term),
    ilike(organizations.region, term),
  )!;
}

export async function listOrganizationChildren(
  database: Database,
  parentOrganizationId: string,
): Promise<OrganizationMembershipSummary[]> {
  return database
    .select(summaryFields)
    .from(organizations)
    .where(and(
      eq(organizations.parentOrganizationId, parentOrganizationId),
      isNull(organizations.consolidatedIntoId),
    ))
    .orderBy(asc(organizations.name), asc(organizations.id));
}

export async function getOrganizationMembershipContext(
  database: Database,
  organizationId: string,
): Promise<{
  parent: OrganizationMembershipSummary | null;
  children: OrganizationMembershipSummary[];
}> {
  const [organization] = await database
    .select({ parentOrganizationId: organizations.parentOrganizationId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  let parent: OrganizationMembershipSummary | null = null;
  if (organization?.parentOrganizationId) {
    const [record] = await database
      .select(summaryFields)
      .from(organizations)
      .where(eq(organizations.id, organization.parentOrganizationId))
      .limit(1);
    parent = record ?? null;
  }

  return {
    parent,
    children: await listOrganizationChildren(database, organizationId),
  };
}

export async function searchEligibleOrganizationParents(
  database: Database,
  query: string,
  childId?: string,
): Promise<OrganizationMembershipSummary[]> {
  const conditions = [
    isNull(organizations.consolidatedIntoId),
    isNull(organizations.parentOrganizationId),
    searchCondition(query),
  ];
  if (childId) conditions.push(ne(organizations.id, childId));

  return database
    .select(summaryFields)
    .from(organizations)
    .where(and(...conditions))
    .orderBy(asc(organizations.name), asc(organizations.city), asc(organizations.id))
    .limit(30);
}

export async function searchEligibleOrganizationChildren(
  database: Database,
  query: string,
  parentOrganizationId: string,
): Promise<OrganizationMembershipCandidate[]> {
  const candidates = await database
    .select({
      ...summaryFields,
      parentOrganizationId: organizations.parentOrganizationId,
    })
    .from(organizations)
    .where(and(
      isNull(organizations.consolidatedIntoId),
      ne(organizations.id, parentOrganizationId),
      or(
        isNull(organizations.parentOrganizationId),
        ne(organizations.parentOrganizationId, parentOrganizationId),
      ),
      searchCondition(query),
    ))
    .orderBy(asc(organizations.name), asc(organizations.city), asc(organizations.id))
    .limit(30);

  const parentIds = [...new Set(candidates.flatMap((candidate) => candidate.parentOrganizationId ? [candidate.parentOrganizationId] : []))];
  const parents = parentIds.length
    ? await database.select(summaryFields).from(organizations).where(inArray(organizations.id, parentIds))
    : [];
  const parentById = new Map(parents.map((parent) => [parent.id, parent]));

  return candidates.map(({ parentOrganizationId, ...candidate }) => ({
    ...candidate,
    currentParent: parentOrganizationId ? parentById.get(parentOrganizationId) ?? null : null,
  }));
}
