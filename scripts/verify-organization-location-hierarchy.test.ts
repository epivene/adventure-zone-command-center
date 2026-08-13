import { describe, expect, it } from "vitest";
import {
  verifyOrganizationLocationHierarchy,
  type OrganizationHierarchyVerificationInput,
} from "./verify-organization-location-hierarchy";

function fixture(
  overrides: Partial<OrganizationHierarchyVerificationInput> = {},
): OrganizationHierarchyVerificationInput {
  return {
    organizations: [
      {
        id: "parent-1",
        name: "Water Lantern Festival",
        parentOrganizationId: null,
      },
      {
        id: "location-1",
        name: "Water Lantern Festival - Austin",
        parentOrganizationId: "parent-1",
      },
      {
        id: "location-2",
        name: "Water Lantern Festival - Dallas",
        parentOrganizationId: "parent-1",
      },
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
    const report = verifyOrganizationLocationHierarchy(
      fixture({
        organizations: [
          {
            id: "standalone-1",
            name: "Water Lantern Festival - Austin",
            parentOrganizationId: null,
          },
        ],
      }),
    );

    expect(report.confirmedFamilyFound).toBe(false);
    expect(report.message).toBe("No matching parent family has been confirmed yet");
  });

  it("detects self-parenting, nesting, orphaned children, and proposed merge risks", () => {
    const report = verifyOrganizationLocationHierarchy(
      fixture({
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
      }),
    );

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

  it("finds the parent when the organization-name filter matches a child", () => {
    const report = verifyOrganizationLocationHierarchy(
      fixture({ organizationName: "Austin" }),
    );

    expect(report).toMatchObject({
      confirmedFamilyFound: true,
      parentCount: 1,
      locationCount: 2,
    });
  });
});
