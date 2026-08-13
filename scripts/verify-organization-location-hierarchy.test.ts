import { describe, expect, it, vi } from "vitest";
import {
  loadProductionInput,
  parseOrganizationName,
  runOrganizationHierarchyVerificationCli,
  verifyOrganizationLocationHierarchy,
  type OrganizationHierarchyVerificationInput,
  type QueryClient,
} from "./verify-organization-location-hierarchy";

function fixture(
  overrides: Partial<OrganizationHierarchyVerificationInput> = {},
): OrganizationHierarchyVerificationInput {
  return {
    organizations: [
      { id: "parent-1", name: "Water Lantern Festival", parentOrganizationId: null },
      { id: "location-1", name: "Water Lantern Festival - Austin", parentOrganizationId: "parent-1" },
      { id: "location-2", name: "Water Lantern Festival - Dallas", parentOrganizationId: "parent-1" },
    ],
    bookingOrganizationIds: ["location-1", "location-2"],
    actLinkOrganizationIds: ["location-1", "location-2"],
    proposedFamilyCandidateIds: [],
    eligibleDuplicateGroups: [],
    organizationName: "Water Lantern Festival",
    ...overrides,
  };
}

describe("organization location hierarchy verifier", () => {
  it("reports a confirmed representative family and its preserved child relationships", () => {
    expect(verifyOrganizationLocationHierarchy(fixture())).toMatchObject({
      parentCount: 1,
      locationCount: 2,
      orphanedChildCount: 0,
      nestedHierarchyCount: 0,
      familyMergeRiskCount: 0,
      preservedBookingCount: 2,
      preservedActLinkCount: 2,
    });
  });

  it("reports an unconfirmed filtered family explicitly", () => {
    const report = verifyOrganizationLocationHierarchy(fixture({
      organizations: [{ id: "standalone-1", name: "Water Lantern Festival - Austin", parentOrganizationId: null }],
    }));
    expect(report.confirmedFamilyFound).toBe(false);
    expect(report.message).toBe("No matching parent family has been confirmed yet");
  });

  it("counts a stale proposal exposed by final duplicate classification as a merge risk", () => {
    const report = verifyOrganizationLocationHierarchy(fixture({
      organizationName: undefined,
      proposedFamilyCandidateIds: ["location-1"],
      eligibleDuplicateGroups: [["location-1", "other"]],
    }));
    expect(report.familyMergeRiskIds).toEqual(["location-1"]);
  });

  it("does not count an active proposed family hidden from destructive duplicate groups", () => {
    const report = verifyOrganizationLocationHierarchy(fixture({
      organizationName: undefined,
      proposedFamilyCandidateIds: ["location-1", "location-2"],
      eligibleDuplicateGroups: [],
    }));
    expect(report.familyMergeRiskCount).toBe(0);
  });

  it("detects self-parenting, nesting, orphaned children, and proposed merge risks", () => {
    const report = verifyOrganizationLocationHierarchy(fixture({
      organizationName: undefined,
      organizations: [
        { id: "parent", name: "Parent", parentOrganizationId: null },
        { id: "child", name: "Child", parentOrganizationId: "parent" },
        { id: "nested", name: "Nested", parentOrganizationId: "child" },
        { id: "orphan", name: "Orphan", parentOrganizationId: "missing" },
        { id: "self", name: "Self", parentOrganizationId: "self" },
        { id: "duplicate", name: "Duplicate", parentOrganizationId: null },
      ],
      bookingOrganizationIds: [],
      actLinkOrganizationIds: [],
      proposedFamilyCandidateIds: ["duplicate", "orphan"],
      eligibleDuplicateGroups: [["duplicate", "other"], ["orphan", "other-2"]],
    }));
    expect(report).toMatchObject({
      selfParentingCount: 1,
      orphanedChildCount: 1,
      nestedHierarchyCount: 1,
      familyMergeRiskCount: 2,
      selfParentingIds: ["self"],
      orphanedParentIds: ["missing"],
      nestedHierarchyIds: ["child"],
      familyMergeRiskIds: ["duplicate", "orphan"],
    });
  });

  it("walks upward and downward from a nested descendant name match", () => {
    const report = verifyOrganizationLocationHierarchy(fixture({
      organizationName: "C",
      organizations: [
        { id: "a", name: "A", parentOrganizationId: null },
        { id: "b", name: "B", parentOrganizationId: "a" },
        { id: "c", name: "C", parentOrganizationId: "b" },
      ],
      bookingOrganizationIds: [],
      actLinkOrganizationIds: [],
    }));
    expect(report).toMatchObject({
      confirmedFamilyFound: true,
      parentCount: 1,
      locationCount: 2,
      nestedHierarchyCount: 1,
      nestedHierarchyIds: ["b"],
    });
  });
});

function queryClient(options: { failAt?: number } = {}) {
  let call = 0;
  const query = vi.fn(async (sql: string) => {
    call += 1;
    if (options.failAt === call) throw new Error("query failed");
    if (sql.startsWith("SELECT id, name")) return { rows: [] };
    if (sql.includes("FROM bookings")) return { rows: [] };
    if (sql.includes("FROM act_external_links")) return { rows: [] };
    if (sql.includes("FROM organization_family_reviews")) return { rows: [] };
    if (sql.includes("FROM organizations AS family_candidate")) return { rows: [] };
    if (sql.includes("GROUP BY lower(trim(name))")) return { rows: [] };
    return { rows: [] };
  });
  return { query, release: vi.fn() } satisfies QueryClient;
}

describe("read-only production boundary", () => {
  it("derives zero risk when a live proposed family overlaps a raw same-name group", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT id, name, website")) return { rows: [
          { id: "one", name: "Festival", website: "festival.test", address_1: "1 A St", city: "Austin", region: "TX", postal_code: "1", parent_organization_id: null },
          { id: "two", name: "Festival", website: "festival.test", address_1: "2 B St", city: "Dallas", region: "TX", postal_code: "2", parent_organization_id: null },
        ] };
        if (sql.includes("FROM organization_family_reviews")) return { rows: [
          { group_key: "organization-family:one|two", candidate_ids: ["one", "two"], status: "proposed" },
        ] };
        if (sql.includes("GROUP BY lower(trim(name))")) return { rows: [
          { normalized_name: "festival", normalized_city: "austin", normalized_region: "tx", ids: ["one", "two"] },
        ] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const input = await loadProductionInput(client, undefined);
    expect(verifyOrganizationLocationHierarchy(input).familyMergeRiskCount).toBe(0);
  });

  it("exposes a stale non-discovered proposal that remains a destructive duplicate", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT id, name, website")) return { rows: [
          { id: "one", name: "Festival", website: null, address_1: "1 A St", city: "Austin", region: "TX", postal_code: "1", parent_organization_id: null },
          { id: "two", name: "Festival", website: null, address_1: "2 B St", city: "Dallas", region: "TX", postal_code: "2", parent_organization_id: null },
        ] };
        if (sql.includes("FROM organization_family_reviews")) return { rows: [
          { group_key: "organization-family:one|two", candidate_ids: ["one", "two"], status: "proposed" },
        ] };
        if (sql.includes("GROUP BY lower(trim(name))")) return { rows: [
          { normalized_name: "festival", normalized_city: "austin", normalized_region: "tx", ids: ["one", "two"] },
        ] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const input = await loadProductionInput(client, undefined);
    expect(verifyOrganizationLocationHierarchy(input).familyMergeRiskCount).toBe(2);
  });

  it("uses a read-only transaction and SELECT-only data reads before commit/release", async () => {
    const client = queryClient();
    await loadProductionInput(client, "Water Lantern Festival");
    const sql = client.query.mock.calls.map(([statement]) => statement.trim());
    expect(sql[0]).toBe("BEGIN TRANSACTION READ ONLY");
    expect(sql.at(-1)).toBe("COMMIT");
    expect(sql.slice(1, -1).every((statement) => statement.startsWith("SELECT"))).toBe(true);
    expect(sql.join(" ")).not.toMatch(/\b(?:insert|update|delete|alter|drop|truncate)\b/i);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases after a read failure", async () => {
    const client = queryClient({ failAt: 3 });
    await expect(loadProductionInput(client, undefined)).rejects.toThrow("query failed");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe("CLI boundary", () => {
  it("requires a nonblank organization value", () => {
    expect(() => parseOrganizationName(["--organization", " "])).toThrow(
      "--organization requires a name",
    );
  });

  it("returns exit 2 without a configured database", async () => {
    const error = vi.fn();
    const code = await runOrganizationHierarchyVerificationCli({
      argv: ["--organization", "Water Lantern Festival"],
      environment: {},
      load: vi.fn(),
      log: vi.fn(),
      error,
    });
    expect(code).toBe(2);
    expect(error).toHaveBeenCalledWith(
      "Database verification unavailable: DATABASE_URL or RENDER_DATABASE_URL is not configured.",
    );
  });

  it("returns exit 1 for an unconfirmed filtered family", async () => {
    const code = await runOrganizationHierarchyVerificationCli({
      argv: ["--organization", "Water Lantern Festival"],
      environment: { DATABASE_URL: "configured-without-logging-it" },
      load: vi.fn(async (organizationName) => fixture({
        organizationName,
        organizations: [{ id: "only", name: "Water Lantern Festival Austin", parentOrganizationId: null }],
      })),
      log: vi.fn(),
      error: vi.fn(),
    });
    expect(code).toBe(1);
  });
});
