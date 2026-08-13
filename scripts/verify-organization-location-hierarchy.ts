#!/usr/bin/env tsx

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
  orphanedChildCount: number;
  nestedHierarchyCount: number;
  familyMergeRiskCount: number;
  preservedBookingCount: number;
  preservedActLinkCount: number;
};

const UNCONFIRMED_MESSAGE =
  "No matching parent family has been confirmed yet";

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
  const matchingIds = filter
    ? new Set(
        input.organizations
          .filter((organization) =>
            organization.name.toLocaleLowerCase("en-US").includes(
              filter.toLocaleLowerCase("en-US"),
            ),
          )
          .map((organization) => organization.id),
      )
    : new Set(input.organizations.map((organization) => organization.id));

  const familyParentIds = new Set<string>();
  for (const organization of input.organizations) {
    if (organization.parentOrganizationId !== null) continue;
    const childIds = childrenByParent.get(organization.id) ?? [];
    if (!childIds.length) continue;
    if (
      !filter ||
      matchingIds.has(organization.id) ||
      childIds.some((id) => matchingIds.has(id))
    ) {
      familyParentIds.add(organization.id);
    }
  }

  const relevantIds = filter
    ? new Set([
        ...matchingIds,
        ...familyParentIds,
        ...[...familyParentIds].flatMap(
          (parentId) => childrenByParent.get(parentId) ?? [],
        ),
      ])
    : new Set(input.organizations.map((organization) => organization.id));
  const relevantOrganizations = input.organizations.filter((organization) =>
    relevantIds.has(organization.id),
  );

  const locationIds = new Set(
    [...familyParentIds].flatMap(
      (parentId) => childrenByParent.get(parentId) ?? [],
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

  const confirmedFamilyFound = familyParentIds.size > 0;
  return {
    organizationFilter: filter ?? null,
    confirmedFamilyFound,
    message:
      filter && !confirmedFamilyFound
        ? UNCONFIRMED_MESSAGE
        : "Organization location hierarchy verification complete",
    parentCount: familyParentIds.size,
    locationCount: locationIds.size,
    selfParentingCount: relevantOrganizations.filter(
      (organization) => organization.parentOrganizationId === organization.id,
    ).length,
    orphanedChildCount: relevantOrganizations.filter(
      (organization) =>
        organization.parentOrganizationId !== null &&
        organization.parentOrganizationId !== organization.id &&
        !organizationById.has(organization.parentOrganizationId),
    ).length,
    nestedHierarchyCount: relevantOrganizations.filter(
      (organization) =>
        organization.parentOrganizationId !== null &&
        organization.parentOrganizationId !== organization.id &&
        (childrenByParent.get(organization.id)?.length ?? 0) > 0,
    ).length,
    familyMergeRiskCount: proposedMergeRiskIds.size,
    preservedBookingCount: input.bookingOrganizationIds.filter((id) =>
      locationIds.has(id),
    ).length,
    preservedActLinkCount: input.actLinkOrganizationIds.filter((id) =>
      locationIds.has(id),
    ).length,
  };
}

function parseOrganizationName(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--organization");
  if (index === -1) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value) throw new Error("--organization requires a name");
  return value;
}

async function loadProductionInput(
  organizationName: string | undefined,
): Promise<OrganizationHierarchyVerificationInput> {
  const { pool } = await import("../lib/db/src/index.ts");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const [
      organizationsResult,
      bookingsResult,
      actLinksResult,
      proposalsResult,
      duplicateGroupsResult,
    ] = await Promise.all([
      client.query<{
        id: string;
        name: string;
        parent_organization_id: string | null;
      }>(
        "SELECT id, name, parent_organization_id FROM organizations ORDER BY id",
      ),
      client.query<{ organization_id: string }>(
        "SELECT organization_id FROM bookings WHERE organization_id IS NOT NULL ORDER BY id",
      ),
      client.query<{ entity_id: string }>(
        "SELECT entity_id FROM act_external_links WHERE entity_type = 'organization' ORDER BY id",
      ),
      client.query<{ candidate_ids: string[] }>(
        "SELECT candidate_ids FROM organization_family_reviews WHERE status = 'proposed' ORDER BY group_key",
      ),
      client.query<{ ids: string[] }>(`
        SELECT array_agg(id ORDER BY created_at ASC) AS ids
        FROM organizations AS duplicate_candidate
        WHERE parent_organization_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM organizations AS confirmed_location
            WHERE confirmed_location.parent_organization_id = duplicate_candidate.id
          )
        GROUP BY lower(trim(name))
        HAVING count(*) > 1
        ORDER BY lower(trim(name))
      `),
    ]);
    await client.query("COMMIT");

    return {
      organizations: organizationsResult.rows.map((organization) => ({
        id: organization.id,
        name: organization.name,
        parentOrganizationId: organization.parent_organization_id,
      })),
      bookingOrganizationIds: bookingsResult.rows.map(
        (booking) => booking.organization_id,
      ),
      actLinkOrganizationIds: actLinksResult.rows.map((link) => link.entity_id),
      proposedFamilyCandidateIds: proposalsResult.rows.flatMap(
        (proposal) => proposal.candidate_ids,
      ),
      eligibleDuplicateGroups: duplicateGroupsResult.rows.map(
        (group) => group.ids,
      ),
      organizationName,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const organizationName = parseOrganizationName(process.argv.slice(2));
  if (!process.env.DATABASE_URL && !process.env.RENDER_DATABASE_URL) {
    console.error(
      "Database verification unavailable: DATABASE_URL or RENDER_DATABASE_URL is not configured.",
    );
    process.exitCode = 2;
    return;
  }

  const report = verifyOrganizationLocationHierarchy(
    await loadProductionInput(organizationName),
  );
  console.log(JSON.stringify(report, null, 2));

  if (
    report.selfParentingCount > 0 ||
    report.orphanedChildCount > 0 ||
    report.nestedHierarchyCount > 0 ||
    report.familyMergeRiskCount > 0
  ) {
    process.exitCode = 1;
  }
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
