import { describe, expect, it } from "vitest";

import {
  buildMigrationApplyManifest,
  migrationApplyManifestDigest,
} from "@/features/act-migration/apply-manifest";
import type {
  MigrationApplyManifestInput,
  MigrationApplyProposal,
} from "@/features/act-migration/apply-types";
import { proposalSnapshotDigest } from "@/features/act-migration/reconciliation";

function proposal(
  proposalKey: string,
  targetEntityType: MigrationApplyProposal["targetEntityType"],
  options: Partial<MigrationApplyProposal> = {},
): MigrationApplyProposal {
  return {
    proposalKey,
    state: "new",
    reviewState: "decided",
    targetEntityType,
    sourceRecordKeys: [`${targetEntityType}:${proposalKey}`],
    candidateLocalIds: [],
    proposedLocalId: null,
    proposedPrimarySourceId: null,
    matchReason: "fixture",
    issueCode: null,
    dependencyProposalKeys: [],
    displaySnapshot: { label: proposalKey },
    decision: "approve_proposed",
    chosenLocalEntityId: null,
    primarySourceId: null,
    ...options,
  };
}

function input(
  proposals: readonly MigrationApplyProposal[] = [
    proposal("organization:alpha", "organization"),
    proposal("contact:alpha", "contact"),
    proposal("organization_contact:alpha", "organization_contact", {
      state: "new_relationship",
      dependencyProposalKeys: ["organization:alpha", "contact:alpha"],
    }),
    proposal("booking:alpha", "booking"),
    proposal("booking_contact:alpha", "booking_contact", {
      state: "new_relationship",
      dependencyProposalKeys: ["booking:alpha", "contact:alpha"],
    }),
    proposal("calling_list:alpha", "calling_list", {
      state: "needs_review",
      issueCode: "group_membership_semantics_unknown",
      decision: "confirm_static_group",
    }),
    proposal("calling_list_member:alpha", "calling_list_member", {
      state: "new_relationship",
      dependencyProposalKeys: ["calling_list:alpha", "contact:alpha"],
    }),
  ],
): MigrationApplyManifestInput {
  return {
    sourceDigest: "finalized-source-digest",
    previewSourceDigest: "finalized-source-digest",
    previewProposalDigest: proposalSnapshotDigest(proposals),
    proposals,
    stableLinks: [],
  };
}

describe("buildMigrationApplyManifest", () => {
  it("builds a deterministic dependency-ordered snapshot of approved operations", () => {
    const value = input();

    const first = buildMigrationApplyManifest(value);
    const replay = buildMigrationApplyManifest({
      ...value,
      proposals: [...value.proposals].reverse(),
    });

    expect(replay.digest).toBe(first.digest);
    expect(migrationApplyManifestDigest(first)).toBe(first.digest);
    expect(first.entries.map((entry) => entry.targetEntityType)).toEqual([
      "organization",
      "contact",
      "organization_contact",
      "booking",
      "booking_contact",
      "calling_list",
      "calling_list_member",
    ]);
    expect(first.entries.map((entry) => entry.operationRank)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(first.counts).toMatchObject({
      proposalTotal: 7,
      runnable: 7,
      reconciled: 0,
      ignored: 0,
      pending: 0,
      failed: 0,
    });
  });

  it("rejects a proposal snapshot that no longer matches the reviewed preview", () => {
    const value = input();

    expect(() =>
      buildMigrationApplyManifest({
        ...value,
        previewProposalDigest: "changed-preview-digest",
      }),
    ).toThrow("preview digest");
  });

  it("requires each unknown-semantics Group to have an individual static confirmation", () => {
    const proposals = input().proposals.map((value) =>
      value.proposalKey === "calling_list:alpha"
        ? { ...value, decision: null, reviewState: "pending" as const }
        : value,
    );

    expect(() => buildMigrationApplyManifest(input(proposals))).toThrow(
      "static Group confirmation",
    );
  });

  it("reconciles stable no-ops only when every source identity has a canonical link", () => {
    const unchanged = proposal("organization:stable", "organization", {
      state: "matched_unchanged",
      reviewState: "not_required",
      decision: null,
      proposedLocalId: "organization-local-id",
      sourceRecordKeys: ["company:ACT-1"],
    });
    const value = input([unchanged]);

    expect(() => buildMigrationApplyManifest(value)).toThrow("stable link");

    const manifest = buildMigrationApplyManifest({
      ...value,
      stableLinks: [
        {
          targetEntityType: "organization",
          localEntityId: "organization-local-id",
          sourceRecordKey: "company:ACT-1",
        },
      ],
    });
    expect(manifest.entries).toEqual([]);
    expect(manifest.counts).toMatchObject({
      proposalTotal: 1,
      reconciled: 1,
      runnable: 0,
    });
  });

  it("carries a duplicate place group's canonical identity and all source IDs", () => {
    const canonicalPlace = proposal("organization:company:ACT-1", "organization", {
      sourceRecordKeys: ["company:ACT-1", "company:ACT-2"],
      duplicateGroupKey: '["example place","1 main denver co"]',
      duplicateSourceIds: ["ACT-1", "ACT-2"],
    });

    const manifest = buildMigrationApplyManifest(input([canonicalPlace]));

    expect(manifest.entries).toEqual([
      expect.objectContaining({
        proposalKey: "organization:company:ACT-1",
        canonicalTargetProposalKey: "organization:company:ACT-1",
        canonicalTargetLocalEntityId: null,
        canonicalSourceIds: ["ACT-1", "ACT-2"],
      }),
    ]);
  });

  it("keeps approved children pending while their duplicate-place canonical target is unresolved", () => {
    const canonicalPlace = proposal("organization:company:ACT-1", "organization", {
      state: "needs_review",
      reviewState: "pending",
      decision: null,
      sourceRecordKeys: ["company:ACT-1", "company:ACT-2"],
      duplicateGroupKey: '["example place","1 main denver co"]',
      duplicateSourceIds: ["ACT-1", "ACT-2"],
    });
    const relationship = proposal("organization_contact:ACT-1:PERSON", "organization_contact", {
      state: "new_relationship",
      dependencyProposalKeys: ["organization:company:ACT-1"],
    });

    const manifest = buildMigrationApplyManifest(input([canonicalPlace, relationship]));

    expect(manifest.entries).toEqual([]);
    expect(manifest.counts).toMatchObject({ runnable: 0, pending: 2 });
  });

  it("rejects an ambiguous canonical stable link", () => {
    const unchanged = proposal("organization:stable", "organization", {
      state: "matched_unchanged",
      reviewState: "not_required",
      decision: null,
      proposedLocalId: "organization-local-id",
      sourceRecordKeys: ["company:ACT-1"],
    });
    const value = input([unchanged]);

    expect(() => buildMigrationApplyManifest({
      ...value,
      stableLinks: [
        { targetEntityType: "organization", localEntityId: "organization-local-id", sourceRecordKey: "company:ACT-1" },
        { targetEntityType: "organization", localEntityId: "another-local-id", sourceRecordKey: "company:ACT-1" },
      ],
    })).toThrow("ambiguous canonical stable link");
  });

  it("keeps ignored, pending, and failed-preview proposals out of operations while counting them", () => {
    const manifest = buildMigrationApplyManifest(input([
      proposal("organization:approved", "organization"),
      proposal("contact:ignored", "contact", {
        state: "ignored",
        reviewState: "ignored",
        decision: "ignore",
      }),
      proposal("booking:pending", "booking", {
        state: "needs_review",
        reviewState: "pending",
        decision: null,
      }),
      proposal("contact:failed", "contact", {
        state: "error",
        reviewState: "not_required",
        decision: null,
        issueCode: "source_record_error",
      }),
    ]));

    expect(manifest.entries.map(({ proposalKey }) => proposalKey)).toEqual([
      "organization:approved",
    ]);
    expect(manifest.counts).toMatchObject({
      proposalTotal: 4,
      runnable: 1,
      ignored: 1,
      pending: 1,
      failed: 1,
    });
  });
});
