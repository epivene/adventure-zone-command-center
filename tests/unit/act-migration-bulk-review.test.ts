import { describe, expect, it } from "vitest";

import {
  bulkReviewEligibility,
  type BulkReviewDependencyStates,
} from "@/features/act-migration/bulk-review";
import type { ActMigrationProposal } from "@/features/act-migration/migration-types";

function proposal(
  input: Partial<ActMigrationProposal> & { proposalKey: string },
): ActMigrationProposal {
  return {
    state: "new",
    reviewState: "pending",
    targetEntityType: "organization",
    sourceRecordKeys: [input.proposalKey],
    candidateLocalIds: [],
    proposedLocalId: null,
    proposedPrimarySourceId: null,
    issueCode: null,
    dependencyProposalKeys: [],
    matchReason: "fixture",
    displaySnapshot: {},
    ...input,
  };
}

function dependencyStates(
  overrides: Partial<BulkReviewDependencyStates> = {},
): BulkReviewDependencyStates {
  return {
    appliedEntityIds: new Set(),
    frozenParentDecisions: new Map(),
    ...overrides,
  };
}

describe("bulkReviewEligibility", () => {
  it("allows only collision-free new proposals and dependency-ready relationships", () => {
    const newPlace = proposal({ proposalKey: "organization:new" });
    const changePlace = proposal({ proposalKey: "organization:change", state: "change" });
    const groupAwaitingConfirmation = proposal({
      proposalKey: "calling_list:group",
      state: "needs_review",
      targetEntityType: "calling_list",
      issueCode: "group_membership_semantics_unknown",
    });
    const parentKeys = ["organization:parent", "contact:parent"];
    const newRelationship = proposal({
      proposalKey: "organization_contact:new",
      state: "new_relationship",
      targetEntityType: "organization_contact",
      dependencyProposalKeys: parentKeys,
    });

    expect(bulkReviewEligibility(newPlace, dependencyStates())).toBe(true);
    expect(bulkReviewEligibility(changePlace, dependencyStates())).toBe(false);
    expect(bulkReviewEligibility(groupAwaitingConfirmation, dependencyStates())).toBe(false);
    expect(bulkReviewEligibility(newRelationship, dependencyStates({
      appliedEntityIds: new Set(parentKeys),
    }))).toBe(true);
    expect(bulkReviewEligibility(newRelationship, dependencyStates())).toBe(false);
  });

  it("requires frozen static Group confirmation for unknown Group memberships", () => {
    const groupMembership = proposal({
      proposalKey: "calling_list_member:group-contact",
      state: "new_relationship",
      targetEntityType: "calling_list_member",
      issueCode: "group_membership_semantics_unknown",
      dependencyProposalKeys: ["calling_list:group", "contact:member"],
    });
    const appliedParents = new Set(["calling_list:group", "contact:member"]);

    expect(bulkReviewEligibility(groupMembership, dependencyStates({
      appliedEntityIds: appliedParents,
      frozenParentDecisions: new Map([["calling_list:group", "confirm_static_group"]]),
    }))).toBe(true);
    expect(bulkReviewEligibility(groupMembership, dependencyStates({
      appliedEntityIds: appliedParents,
      frozenParentDecisions: new Map([["calling_list:group", "approve_proposed"]]),
    }))).toBe(false);
  });
});
