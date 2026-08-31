import { describe, expect, it } from "vitest";

import {
  KNOWN_EMPTY_TEST_PROFILE_CLUSTERS,
  cleanupKnownEmptyTestProfileClusters,
  isAllowedTestClusterReference,
  isBlankTestClusterOrganization,
  type KnownEmptyTestProfileClusterCandidate,
  type KnownEmptyTestProfileClusterCleanupOutcome,
  type KnownEmptyTestProfileClusterRepository,
} from "./known-empty-test-profile-cluster-cleanup";

class FakeClusterRepository implements KnownEmptyTestProfileClusterRepository {
  readonly requested: KnownEmptyTestProfileClusterCandidate[] = [];

  constructor(
    private readonly outcomes = new Map<string, KnownEmptyTestProfileClusterCleanupOutcome>(),
  ) {}

  async remove(candidate: KnownEmptyTestProfileClusterCandidate): Promise<KnownEmptyTestProfileClusterCleanupOutcome> {
    this.requested.push(candidate);
    return this.outcomes.get(candidate.id) ?? "deleted";
  }
}

describe("cleanupKnownEmptyTestProfileClusters", () => {
  it("targets only the two known canonical test clusters", async () => {
    const repository = new FakeClusterRepository();

    const result = await cleanupKnownEmptyTestProfileClusters(repository);

    expect(repository.requested).toEqual(KNOWN_EMPTY_TEST_PROFILE_CLUSTERS);
    expect(result.deleted).toEqual(KNOWN_EMPTY_TEST_PROFILE_CLUSTERS.map((candidate) => candidate.id));
    expect(result.alreadyAbsent).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("is repeat-safe and surfaces an unsafe cluster without forcing deletion", async () => {
    const [alreadyGone, unsafe] = KNOWN_EMPTY_TEST_PROFILE_CLUSTERS;
    const repository = new FakeClusterRepository(new Map([
      [alreadyGone.id, "missing"],
      [unsafe.id, "unsafe"],
    ]));

    const result = await cleanupKnownEmptyTestProfileClusters(repository);

    expect(result.deleted).toEqual([]);
    expect(result.alreadyAbsent).toEqual([alreadyGone.id]);
    expect(result.skipped).toEqual([{ id: unsafe.id, reason: "unsafe" }]);
  });
});

describe("cluster safety guards", () => {
  const rootId = "08e8e9b8-618a-4129-ab14-640345c1abf0";

  it("accepts a structurally blank root and retired child but rejects profile content or hierarchy links", () => {
    expect(isBlankTestClusterOrganization({
      id: rootId,
      name: "Double-Run Fairs",
      city: null,
      region: null,
      profile: {
        place_type: "other",
        consolidated_into_id: null,
        parent_organization_id: null,
        phone: null,
        website: null,
        description: null,
        last_resort: false,
        filler: false,
      },
    }, null)).toBe(true);

    expect(isBlankTestClusterOrganization({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Repeat Fair A",
      city: "Rockford",
      region: "IL",
      profile: {
        place_type: "other",
        consolidated_into_id: rootId,
        parent_organization_id: null,
        phone: null,
        website: null,
        description: null,
        last_resort: false,
        filler: false,
      },
    }, rootId)).toBe(true);

    expect(isBlankTestClusterOrganization({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Unsafe child",
      city: null,
      region: null,
      profile: {
        place_type: "other",
        consolidated_into_id: rootId,
        parent_organization_id: null,
        website: "https://real-event.example",
      },
    }, rootId)).toBe(false);

    expect(isBlankTestClusterOrganization({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Nested organization",
      city: null,
      region: null,
      profile: {
        place_type: "other",
        consolidated_into_id: rootId,
        parent_organization_id: "44444444-4444-4444-8444-444444444444",
      },
    }, rootId)).toBe(false);
  });

  it("allows only internal consolidation pointers and deletable location rows", () => {
    expect(isAllowedTestClusterReference({
      schemaName: "public",
      tableName: "organizations",
      columnName: "consolidated_into_id",
    })).toBe(true);
    expect(isAllowedTestClusterReference({
      schemaName: "public",
      tableName: "organization_locations",
      columnName: "organization_id",
    })).toBe(true);
    expect(isAllowedTestClusterReference({
      schemaName: "public",
      tableName: "organization_locations",
      columnName: "consolidation_source_org_id",
    })).toBe(true);

    expect(isAllowedTestClusterReference({
      schemaName: "public",
      tableName: "bookings",
      columnName: "organization_id",
    })).toBe(false);
    expect(isAllowedTestClusterReference({
      schemaName: "public",
      tableName: "organizations",
      columnName: "parent_organization_id",
    })).toBe(false);
  });
});
