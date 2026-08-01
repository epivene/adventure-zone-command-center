import { describe, expect, it } from "vitest";

import type { ActMigrationProposal } from "@/features/act-migration/migration-types";
import {
  proposalSnapshotDigest,
  reconcileMigrationPreview,
} from "@/features/act-migration/reconciliation";
import type {
  ActMigrationCheckpoint,
  FinalizedSourceSnapshot,
} from "@/features/act-migration/snapshot-repository";
import { sourceSnapshotDigest } from "@/features/act-migration/snapshot-repository";
import {
  parseSourceItem,
  type StagedSourceItem,
} from "@/features/act-migration/source-parser";

function staged(
  streamType: Parameters<typeof parseSourceItem>[0],
  rawSnapshot: Record<string, unknown>,
): StagedSourceItem {
  const parsed = parseSourceItem(streamType, rawSnapshot);
  if (!parsed.ok) throw new Error("Expected valid reconciliation fixture.");
  const normalized = parsed.normalized as Record<string, unknown>;
  return {
    streamType,
    sourceKey: parsed.sourceKey,
    sourceId: parsed.sourceId,
    targetSourceId:
      "targetSourceId" in normalized
        ? (normalized.targetSourceId as string)
        : null,
    rawSnapshot: parsed.rawSnapshot,
    normalizedSnapshot: normalized,
    fingerprint: parsed.fingerprint,
    errorCode: null,
    errorFields: [],
  };
}

function checkpoint(
  id: string,
  status: ActMigrationCheckpoint["status"] = "complete",
): ActMigrationCheckpoint {
  return {
    id,
    runId: "run-1",
    streamType: "company",
    partitionKey: id,
    parentSourceId: null,
    nextSkip: 0,
    pageSize: 100,
    queryMode: "projected",
    status,
    retryAfter: null,
    retryable: false,
  };
}

function source(
  records: readonly StagedSourceItem[],
  checkpoints: readonly ActMigrationCheckpoint[] = [checkpoint("complete")],
): FinalizedSourceSnapshot {
  return {
    runId: "run-1",
    records,
    checkpoints,
    sourceDigest: sourceSnapshotDigest(records),
  };
}

function proposal(
  proposalKey: string,
  sourceRecordKeys: readonly string[],
  dependencyProposalKeys: readonly string[] = [],
): ActMigrationProposal {
  return {
    proposalKey,
    state: "new",
    reviewState: "pending",
    targetEntityType: "organization",
    sourceRecordKeys,
    candidateLocalIds: [],
    proposedLocalId: null,
    proposedPrimarySourceId: null,
    matchReason: "fixture",
    issueCode: null,
    dependencyProposalKeys,
    displaySnapshot: { name: proposalKey },
  };
}

const records = [
  staged("company", {
    id: "COMPANY-1",
    name: "Example Place",
    address: { city: "Denver", state: "CO" },
  }),
  staged("contact", {
    id: "CONTACT-1",
    fullName: "Avery Person",
  }),
  staged("company_contact", {
    sourceId: "COMPANY-1",
    targetSourceId: "CONTACT-1",
  }),
  staged("opportunity", {
    id: "OPPORTUNITY-1",
    name: "Annual Fair",
  }),
];
const proposals = [
  proposal("organization:1", ["company:COMPANY-1"]),
  {
    ...proposal("contact:1", ["contact:CONTACT-1"]),
    targetEntityType: "contact" as const,
  },
  {
    ...proposal(
      "organization_contact:1",
      ["company_contact:COMPANY-1:CONTACT-1"],
      ["organization:1", "contact:1"],
    ),
    state: "new_relationship" as const,
    targetEntityType: "organization_contact" as const,
  },
  {
    ...proposal("booking:1", ["opportunity:OPPORTUNITY-1"]),
    targetEntityType: "booking" as const,
    issueCode: "opportunity_place_missing" as const,
  },
];

describe("reconcileMigrationPreview", () => {
  it("hashes immutable proposal evidence independently of input ordering", () => {
    const forward = proposalSnapshotDigest(proposals);
    const reordered = proposalSnapshotDigest(
      proposals.toReversed().map((value) => ({
        ...value,
        sourceRecordKeys: value.sourceRecordKeys.toReversed(),
        candidateLocalIds: value.candidateLocalIds.toReversed(),
        dependencyProposalKeys: value.dependencyProposalKeys.toReversed(),
        displaySnapshot: Object.fromEntries(
          Object.entries(value.displaySnapshot).toReversed(),
        ),
      })),
    );

    expect(reordered).toBe(forward);
    expect(proposalSnapshotDigest([
      { ...proposals[0]!, reviewState: "decided" },
      ...proposals.slice(1),
    ])).not.toBe(forward);
  });

  it("counts source coverage, gaps, checkpoints, and preview states", () => {
    const report = reconcileMigrationPreview({
      source: source(records),
      proposals,
    });

    expect(report).toMatchObject({
      sourceCounts: {
        company: 1,
        contact: 1,
        opportunity: 1,
        group: 0,
      },
      relationshipCounts: {
        company_contact: 1,
        opportunity_company: 0,
        opportunity_contact: 0,
        group_contact: 0,
      },
      previewCounts: {
        new: 3,
        matched_unchanged: 0,
        change: 0,
        new_relationship: 1,
        possible_duplicate: 0,
        needs_review: 0,
        ignored: 0,
        error: 0,
      },
      placesWithoutPeople: 0,
      multiPlacePeople: 0,
      opportunitiesWithoutPlace: 1,
      opportunitiesWithoutPerson: 1,
      duplicateSourceIdConflicts: 0,
      incompleteCheckpoints: 0,
      failedCheckpoints: 0,
      complete: true,
    });
    expect(report.sourceDigest).toBe(sourceSnapshotDigest(records));
    expect(report.proposalDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a source array that does not match its finalized provenance digest", () => {
    expect(() =>
      reconcileMigrationPreview({
        source: {
          ...source(records),
          sourceDigest: "stale-finalized-source-digest",
        },
        proposals,
      }),
    ).toThrow(
      "Act migration source digest does not match the finalized snapshot.",
    );
  });

  it.each([
    {
      name: "a missing source owner",
      proposals: proposals.slice(1),
      checkpoints: [checkpoint("complete")],
    },
    {
      name: "duplicate source ownership",
      proposals: [
        ...proposals,
        proposal("duplicate", ["company:COMPANY-1"]),
      ],
      checkpoints: [checkpoint("complete")],
    },
    {
      name: "a missing proposal dependency",
      proposals: [
        ...proposals,
        proposal("dependent", [], ["missing-parent"]),
      ],
      checkpoints: [checkpoint("complete")],
    },
    {
      name: "a pending checkpoint",
      proposals,
      checkpoints: [checkpoint("pending", "pending")],
    },
    {
      name: "a failed checkpoint",
      proposals,
      checkpoints: [checkpoint("failed", "failed")],
    },
  ])("is incomplete for $name", ({ proposals: values, checkpoints }) => {
    expect(
      reconcileMigrationPreview({
        source: source(records, checkpoints),
        proposals: values,
      }).complete,
    ).toBe(false);
  });

  it("counts duplicate-conflict error rows without collapsing their keys", () => {
    const conflict: StagedSourceItem = {
      streamType: "contact",
      sourceKey: "error:contact:duplicate",
      sourceId: null,
      targetSourceId: null,
      rawSnapshot: {},
      normalizedSnapshot: {},
      fingerprint: "conflict",
      errorCode: "duplicate_source_id_conflict",
      errorFields: ["id"],
    };
    const report = reconcileMigrationPreview({
      source: source([conflict]),
      proposals: [
        {
          ...proposal("error:duplicate", [conflict.sourceKey]),
          state: "error",
          reviewState: "not_required",
          targetEntityType: "contact",
          issueCode: "duplicate_source_id_conflict",
        },
      ],
    });

    expect(report.duplicateSourceIdConflicts).toBe(1);
    expect(report.sourceCounts.contact).toBe(1);
    expect(report.complete).toBe(true);
  });

  it("canonicalizes source, proposal, nested array, and display object order", () => {
    const forward = reconcileMigrationPreview({
      source: source(records),
      proposals,
    });
    const reversed = reconcileMigrationPreview({
      source: source(records.toReversed()),
      proposals: proposals
        .toReversed()
        .map((value) => ({
          ...value,
          sourceRecordKeys: value.sourceRecordKeys.toReversed(),
          candidateLocalIds: value.candidateLocalIds.toReversed(),
          dependencyProposalKeys:
            value.dependencyProposalKeys.toReversed(),
          displaySnapshot: Object.fromEntries(
            Object.entries(value.displaySnapshot).toReversed(),
          ),
        })),
    });

    expect(reversed.sourceDigest).toBe(forward.sourceDigest);
    expect(reversed.proposalDigest).toBe(forward.proposalDigest);
    expect(reversed.complete).toBe(true);
  });

  it("derives relationship-quality metrics from resolved proposal identities", () => {
    const metricRecords = [
      staged("company", { id: "COMPANY-A", name: "A" }),
      staged("company", { id: "COMPANY-B", name: "B" }),
      staged("company", { id: "COMPANY-C", name: "C" }),
      staged("contact", { id: "CONTACT-1", fullName: "Avery Person" }),
      staged("contact", { id: "CONTACT-ALIAS", fullName: "Avery Person" }),
      staged("contact", {
        id: "CONTACT-GENERIC",
        fullName: "Info",
        company: "C",
      }),
      staged("company_contact", {
        sourceId: "COMPANY-A",
        targetSourceId: "CONTACT-1",
      }),
      staged("company_contact", {
        sourceId: "COMPANY-B",
        targetSourceId: "CONTACT-ALIAS",
      }),
      staged("company_contact", {
        sourceId: "COMPANY-C",
        targetSourceId: "CONTACT-GENERIC",
      }),
      staged("opportunity", { id: "OPPORTUNITY-1", name: "Event" }),
      staged("opportunity_company", {
        sourceId: "OPPORTUNITY-1",
        targetSourceId: "COMPANY-C",
      }),
      staged("opportunity_contact", {
        sourceId: "OPPORTUNITY-1",
        targetSourceId: "CONTACT-GENERIC",
      }),
    ];
    const metricProposals: ActMigrationProposal[] = [
      proposal("organization:A", ["company:COMPANY-A"]),
      proposal("organization:B", ["company:COMPANY-B"]),
      proposal("organization:C", [
        "company:COMPANY-C",
        "company_contact:COMPANY-C:CONTACT-GENERIC",
        "contact:CONTACT-GENERIC",
      ]),
      {
        ...proposal("contact:person", [
          "contact:CONTACT-1",
          "contact:CONTACT-ALIAS",
        ]),
        targetEntityType: "contact",
      },
      {
        ...proposal(
          "organization_contact:A",
          ["company_contact:COMPANY-A:CONTACT-1"],
          ["organization:A", "contact:person"],
        ),
        state: "new_relationship",
        targetEntityType: "organization_contact",
      },
      {
        ...proposal(
          "organization_contact:B",
          ["company_contact:COMPANY-B:CONTACT-ALIAS"],
          ["organization:B", "contact:person"],
        ),
        state: "new_relationship",
        targetEntityType: "organization_contact",
      },
      {
        ...proposal(
          "booking:unresolved",
          [
            "opportunity:OPPORTUNITY-1",
            "opportunity_company:OPPORTUNITY-1:COMPANY-C",
          ],
          ["organization:C"],
        ),
        state: "needs_review",
        targetEntityType: "booking",
        issueCode: "opportunity_place_ambiguous",
      },
      {
        ...proposal(
          "booking_contact:unresolved",
          ["opportunity_contact:OPPORTUNITY-1:CONTACT-GENERIC"],
          ["booking:unresolved", "organization:C"],
        ),
        state: "needs_review",
        targetEntityType: "booking_contact",
        issueCode: "parent_proposal_unresolved",
      },
    ];

    expect(
      reconcileMigrationPreview({
        source: source(metricRecords),
        proposals: metricProposals,
      }),
    ).toMatchObject({
      placesWithoutPeople: 1,
      multiPlacePeople: 1,
      opportunitiesWithoutPlace: 1,
      opportunitiesWithoutPerson: 1,
      complete: true,
    });
  });
});
