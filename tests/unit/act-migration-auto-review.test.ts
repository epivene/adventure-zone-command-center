import { describe, expect, it } from "vitest";

import {
  autoReviewMigrationProposals,
} from "@/features/act-migration/auto-review";
import type { ActMigrationProposal } from "@/features/act-migration/migration-types";

function proposal(
  proposalKey: string,
  options: Partial<ActMigrationProposal> = {},
): ActMigrationProposal {
  return {
    proposalKey,
    state: "new",
    reviewState: "pending",
    targetEntityType: "organization",
    sourceRecordKeys: ["company:ACT-1"],
    candidateLocalIds: [],
    proposedLocalId: null,
    proposedPrimarySourceId: null,
    matchReason: "fixture",
    issueCode: null,
    dependencyProposalKeys: [],
    displaySnapshot: { name: "Example Fair" },
    ...options,
  };
}

describe("autoReviewMigrationProposals", () => {
  it("approves an exact duplicate group and its dependency-ready relationship", () => {
    const exactPlace = proposal("organization:company:ACT-1", {
      sourceRecordKeys: ["company:ACT-1", "company:ACT-2"],
      duplicateGroupKey: '["example fair","1 main denver co"]',
      duplicateSourceIds: ["ACT-1", "ACT-2"],
      matchReason: "exact_normalized_place_duplicate_group",
    });
    const relationship = proposal("organization_contact:ACT-1:CONTACT-1", {
      state: "new_relationship",
      targetEntityType: "organization_contact",
      sourceRecordKeys: ["company_contact:ACT-1:CONTACT-1"],
      dependencyProposalKeys: [exactPlace.proposalKey, "contact:CONTACT-1"],
    });
    const contact = proposal("contact:CONTACT-1", {
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:CONTACT-1"],
      proposedPrimarySourceId: "CONTACT-1",
    });

    const result = autoReviewMigrationProposals([
      relationship,
      exactPlace,
      contact,
    ]);

    expect(result.approvedProposalKeys).toEqual([
      "contact:CONTACT-1",
      "organization:company:ACT-1",
      "organization_contact:ACT-1:CONTACT-1",
    ]);
    expect(result.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        proposalKey: exactPlace.proposalKey,
        reviewState: "decided",
      }),
      expect.objectContaining({
        proposalKey: relationship.proposalKey,
        reviewState: "decided",
      }),
    ]));
  });

  it("keeps near matches and conflicting-source history pending", () => {
    const nearMatch = proposal("organization:company:NEAR", {
      state: "possible_duplicate",
      candidateLocalIds: ["local-place"],
      proposedLocalId: "local-place",
      matchReason: "unique_name_city_region",
    });
    const conflictingHistory = proposal("contact:error:ACT-1", {
      state: "error",
      reviewState: "not_required",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:ACT-1"],
      issueCode: "duplicate_source_id_conflict",
      matchReason: "duplicate_source_id_conflict",
      displaySnapshot: { sourceKey: "contact:ACT-1" },
    });
    const changedPlace = proposal("organization:company:CHANGED", {
      state: "change",
      proposedLocalId: "local-place",
      candidateLocalIds: ["local-place"],
    });

    const result = autoReviewMigrationProposals([
      nearMatch,
      conflictingHistory,
      changedPlace,
    ]);

    expect(result.approvedProposalKeys).toEqual([]);
    expect(result.pendingProposalKeys).toEqual([
      "organization:company:CHANGED",
      "organization:company:NEAR",
    ]);
    expect(result.proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        proposalKey: nearMatch.proposalKey,
        reviewState: "pending",
      }),
      expect.objectContaining({
        proposalKey: conflictingHistory.proposalKey,
        state: "error",
        issueCode: "duplicate_source_id_conflict",
      }),
    ]));
  });
});
