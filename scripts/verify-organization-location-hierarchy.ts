#!/usr/bin/env tsx

import {
  discoverOrganizationFamilyCandidates,
  partitionOrganizationReviewGroups,
  type OrganizationFamilyActRelationship,
} from "../artifacts/api-server/src/features/organizations/organization-family-discovery";

export type OrganizationHierarchyVerificationInput = {
  organizations: readonly {
    id: string;
    name: string;
    parentOrganizationId: string | null;
  }[];
  bookingOrganizationIds: readonly string[];
  actLinkOrganizationIds: readonly string[];
  proposedFamilyCandidateIds: readonly string[];
  eligibleDuplicateGroups: readonly (readonly string[])[];
  organizationName?: string;
};

export type OrganizationHierarchyVerificationReport = {
  organizationFilter: string | null;
  confirmedFamilyFound: boolean;
  message: string;
  parentCount: number;
  locationCount: number;
  selfParentingCount: number;
  selfParentingIds: string[];
  orphanedChildCount: number;
  orphanedParentIds: string[];
  nestedHierarchyCount: number;
  nestedHierarchyIds: string[];
  familyMergeRiskCount: number;
  familyMergeRiskIds: string[];
  preservedBookingCount: number;
  preservedActLinkCount: number;
};

export type QueryClient = {
  query(sql: string): Promise<{ rows: any[] }>;
  release(): void;
};

const UNCONFIRMED_MESSAGE =
  "No matching parent family has been confirmed yet";

function connectedIds(
  organizations: OrganizationHierarchyVerificationInput["organizations"],
  matchingIds: ReadonlySet<string>,
): Set<string> {
  const adjacent = new Map<string, Set<string>>(
    organizations.map((organization) => [organization.id, new Set<string>()]),
  );
  for (const organization of organizations) {
    const parentId = organization.parentOrganizationId;
    if (!parentId || parentId === organization.id || !adjacent.has(parentId)) continue;
    adjacent.get(organization.id)?.add(parentId);
    adjacent.get(parentId)?.add(organization.id);
  }
  const connected = new Set(matchingIds);
  const pending = [...matchingIds];
  while (pending.length) {
    const id = pending.pop()!;
    for (const adjacentId of adjacent.get(id) ?? []) {
      if (connected.has(adjacentId)) continue;
      connected.add(adjacentId);
      pending.push(adjacentId);
    }
  }
  return connected;
}

export function verifyOrganizationLocationHierarchy(
  input: OrganizationHierarchyVerificationInput,
): OrganizationHierarchyVerificationReport {
  const organizationById = new Map(
    input.organizations.map((organization) => [organization.id, organization]),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const organization of input.organizations) {
    if (!organization.parentOrganizationId) continue;
    const children = childrenByParent.get(organization.parentOrganizationId) ?? [];
    children.push(organization.id);
    childrenByParent.set(organization.parentOrganizationId, children);
  }

  const filter = input.organizationName?.trim() || undefined;
  const matchingIds = new Set(
    input.organizations
      .filter(
        (organization) =>
          !filter ||
          organization.name
            .toLocaleLowerCase("en-US")
            .includes(filter.toLocaleLowerCase("en-US")),
      )
      .map((organization) => organization.id),
  );
  const relevantIds = filter
    ? connectedIds(input.organizations, matchingIds)
    : new Set(input.organizations.map((organization) => organization.id));
  const relevantOrganizations = input.organizations.filter((organization) =>
    relevantIds.has(organization.id),
  );

  const familyParentIds = new Set(
    relevantOrganizations.flatMap((organization) =>
      organization.parentOrganizationId === null &&
      (childrenByParent.get(organization.id)?.some((id) => relevantIds.has(id)) ??
        false)
        ? [organization.id]
        : [],
    ),
  );
  const locationIds = new Set(
    relevantOrganizations.flatMap((organization) =>
      organization.parentOrganizationId !== null &&
      organization.parentOrganizationId !== organization.id &&
      organizationById.has(organization.parentOrganizationId)
        ? [organization.id]
        : [],
    ),
  );

  const duplicateEligibleIds = new Set(
    input.eligibleDuplicateGroups.flatMap((ids) => [...ids]),
  );
  const proposedMergeRiskIds = new Set(
    input.proposedFamilyCandidateIds.filter(
      (id) => relevantIds.has(id) && duplicateEligibleIds.has(id),
    ),
  );

  const selfParentingIds = relevantOrganizations
    .filter(
      (organization) => organization.parentOrganizationId === organization.id,
    )
    .map((organization) => organization.id)
    .sort();
  const orphanedParentIds = [
    ...new Set(
      relevantOrganizations.flatMap((organization) =>
        organization.parentOrganizationId !== null &&
        organization.parentOrganizationId !== organization.id &&
        !organizationById.has(organization.parentOrganizationId)
          ? [organization.parentOrganizationId]
          : [],
      ),
    ),
  ].sort();
  const orphanedChildIds = relevantOrganizations
    .filter(
      (organization) =>
        organization.parentOrganizationId !== null &&
        organization.parentOrganizationId !== organization.id &&
        !organizationById.has(organization.parentOrganizationId),
    )
    .map((organization) => organization.id);
  const nestedHierarchyIds = relevantOrganizations
    .filter(
      (organization) =>
        organization.parentOrganizationId !== null &&
        organization.parentOrganizationId !== organization.id &&
        (childrenByParent.get(organization.id)?.some((id) => relevantIds.has(id)) ??
          false),
    )
    .map((organization) => organization.id)
    .sort();
  const familyMergeRiskIds = [...proposedMergeRiskIds].sort();

  const confirmedFamilyFound =
    familyParentIds.size > 0 && locationIds.size > 0;
  return {
    organizationFilter: filter ?? null,
    confirmedFamilyFound,
    message:
      filter && !confirmedFamilyFound
        ? UNCONFIRMED_MESSAGE
        : "Organization location hierarchy verification complete",
    parentCount: familyParentIds.size,
    locationCount: locationIds.size,
    selfParentingCount: selfParentingIds.length,
    selfParentingIds,
    orphanedChildCount: orphanedChildIds.length,
    orphanedParentIds,
    nestedHierarchyCount: nestedHierarchyIds.length,
    nestedHierarchyIds,
    familyMergeRiskCount: familyMergeRiskIds.length,
    familyMergeRiskIds,
    preservedBookingCount: input.bookingOrganizationIds.filter((id) =>
      locationIds.has(id),
    ).length,
    preservedActLinkCount: input.actLinkOrganizationIds.filter((id) =>
      locationIds.has(id),
    ).length,
  };
}

export function parseOrganizationName(
  argv: readonly string[],
): string | undefined {
  const index = argv.indexOf("--organization");
  if (index === -1) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value) throw new Error("--organization requires a name");
  return value;
}

export async function loadProductionInput(
  client: QueryClient,
  organizationName: string | undefined,
): Promise<OrganizationHierarchyVerificationInput> {
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const organizationsResult = await client.query(`
      SELECT id, name, website, address_1, city, region, postal_code,
             parent_organization_id
      FROM organizations
      ORDER BY id
    `);
    const bookingsResult = await client.query(
      "SELECT organization_id FROM bookings WHERE organization_id IS NOT NULL ORDER BY id",
    );
    const actLinksResult = await client.query(
      "SELECT entity_id FROM act_external_links WHERE entity_type = 'organization' ORDER BY id",
    );
    const reviewsResult = await client.query(
      "SELECT group_key, candidate_ids, status FROM organization_family_reviews ORDER BY group_key",
    );
    const relationshipsResult = await client.query(`
      SELECT DISTINCT source_link.entity_id AS "sourceOrganizationId",
             target_link.entity_id AS "targetOrganizationId",
             'act_relationship'::text AS provenance
      FROM act_migration_records AS left_relationship
      INNER JOIN act_migration_records AS right_relationship
        ON right_relationship.run_id = left_relationship.run_id
        AND right_relationship.stream_type = 'company_contact'
        AND right_relationship.target_source_id = left_relationship.target_source_id
        AND right_relationship.source_id > left_relationship.source_id
      INNER JOIN act_external_links AS source_link
        ON source_link.entity_type = 'organization'
        AND source_link.source_entity_type = 'company'
        AND source_link.act_record_id = left_relationship.source_id
        AND source_link.migration_run_id = left_relationship.run_id
      INNER JOIN act_external_links AS target_link
        ON target_link.entity_type = 'organization'
        AND target_link.source_entity_type = 'company'
        AND target_link.act_record_id = right_relationship.source_id
        AND target_link.migration_run_id = right_relationship.run_id
      WHERE left_relationship.stream_type = 'company_contact'
        AND source_link.entity_id <> target_link.entity_id
      ORDER BY source_link.entity_id, target_link.entity_id
    `);
    const duplicateGroupsResult = await client.query(`
      SELECT lower(trim(name)) AS normalized_name,
             min(lower(trim(coalesce(city, '')))) AS normalized_city,
             min(lower(trim(coalesce(region, '')))) AS normalized_region,
             array_agg(id ORDER BY created_at ASC) AS ids
      FROM organizations AS duplicate_candidate
      WHERE parent_organization_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM organizations AS confirmed_location
          WHERE confirmed_location.parent_organization_id = duplicate_candidate.id
        )
      GROUP BY lower(trim(name))
      HAVING count(*) > 1
      ORDER BY lower(trim(name))
    `);

    const organizations = organizationsResult.rows.map((organization) => ({
      id: organization.id as string,
      name: organization.name as string,
      website: organization.website as string | null,
      address1: organization.address_1 as string | null,
      city: organization.city as string | null,
      region: organization.region as string | null,
      postalCode: organization.postal_code as string | null,
      parentOrganizationId: organization.parent_organization_id as string | null,
    }));
    const parentsWithLocations = new Set(
      organizations.flatMap((organization) =>
        organization.parentOrganizationId
          ? [organization.parentOrganizationId]
          : [],
      ),
    );
    const standaloneCandidates = organizations.filter(
      (organization) =>
        organization.parentOrganizationId === null &&
        !parentsWithLocations.has(organization.id) &&
        organization.website?.trim(),
    );
    const discoveredFamilies = discoverOrganizationFamilyCandidates(
      standaloneCandidates,
      relationshipsResult.rows as OrganizationFamilyActRelationship[],
    );
    const reviews = reviewsResult.rows.map((review) => ({
      groupKey: review.group_key as string,
      status: review.status as "proposed" | "not_related",
    }));
    const finalGroups = partitionOrganizationReviewGroups(
      duplicateGroupsResult.rows,
      discoveredFamilies,
      reviews,
    );
    await client.query("COMMIT");

    return {
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        parentOrganizationId: organization.parentOrganizationId,
      })),
      bookingOrganizationIds: bookingsResult.rows.map(
        (booking) => booking.organization_id as string,
      ),
      actLinkOrganizationIds: actLinksResult.rows.map(
        (link) => link.entity_id as string,
      ),
      proposedFamilyCandidateIds: reviewsResult.rows
        .filter((review) => review.status === "proposed")
        .flatMap((review) => review.candidate_ids as string[]),
      eligibleDuplicateGroups: finalGroups
        .filter((group) => group.classification === "duplicate")
        .map((group) => group.candidateIds),
      organizationName,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runOrganizationHierarchyVerificationCli(input: {
  argv: readonly string[];
  environment: Record<string, string | undefined>;
  load(organizationName: string | undefined): Promise<OrganizationHierarchyVerificationInput>;
  log(message: string): void;
  error(message: string): void;
}): Promise<number> {
  const organizationName = parseOrganizationName(input.argv);
  if (!input.environment.DATABASE_URL && !input.environment.RENDER_DATABASE_URL) {
    input.error(
      "Database verification unavailable: DATABASE_URL or RENDER_DATABASE_URL is not configured.",
    );
    return 2;
  }
  const report = verifyOrganizationLocationHierarchy(
    await input.load(organizationName),
  );
  input.log(JSON.stringify(report, null, 2));
  return report.selfParentingCount > 0 ||
    report.orphanedChildCount > 0 ||
    report.nestedHierarchyCount > 0 ||
    report.familyMergeRiskCount > 0 ||
    (Boolean(organizationName) && !report.confirmedFamilyFound)
    ? 1
    : 0;
}

async function main() {
  const { pool } = await import("../lib/db/src/index.ts");
  const exitCode = await runOrganizationHierarchyVerificationCli({
    argv: process.argv.slice(2),
    environment: process.env,
    load: async (organizationName) => {
      const client = await pool.connect();
      try {
        return await loadProductionInput(client, organizationName);
      } finally {
        await pool.end();
      }
    },
    log: console.log,
    error: console.error,
  });
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Organization hierarchy verification failed",
    );
    process.exitCode = 1;
  });
}
