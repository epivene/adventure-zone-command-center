import { createHash } from "node:crypto";

import {
  actRelationshipTypeValues,
  actSourceEntityTypeValues,
  migrationPreviewStateValues,
  type ActMigrationProposal,
  type ActRelationshipType,
  type ActSourceEntityType,
  type MigrationPreviewState,
} from "@/features/act-migration/migration-types";
import {
  sourceSnapshotDigest,
  type FinalizedSourceSnapshot,
} from "@/features/act-migration/snapshot-repository";
import type { MigrationApplyManifest } from "@/features/act-migration/apply-types";
import type {
  MigrationApplyCounts,
  MigrationApplyWorkspace,
} from "@/features/act-migration/apply-repository";
import {
  autoReviewMigrationProposals,
} from "@/features/act-migration/auto-review";

export type MigrationReconciliationReport = {
  sourceCounts: Record<ActSourceEntityType, number>;
  relationshipCounts: Record<ActRelationshipType, number>;
  previewCounts: Record<MigrationPreviewState, number>;
  placesWithoutPeople: number;
  multiPlacePeople: number;
  opportunitiesWithoutPlace: number;
  opportunitiesWithoutPerson: number;
  duplicateSourceIdConflicts: number;
  incompleteCheckpoints: number;
  failedCheckpoints: number;
  autoApproved?: number;
  reviewRequired?: number;
  sourceDigest: string;
  proposalDigest: string;
  complete: boolean;
};

/** Count-only evidence for a reviewed manifest and its local CRM apply queue. */
export type MigrationApplyReconciliationReport = {
  proposalTotal: number;
  /** Stable Act! links that required no local CRM write. */
  reconciled: number;
  /** Reviewed proposals that the manifest permits the queue to apply. */
  approved: number;
  /** Approved proposals with a durable apply operation. */
  scheduled: number;
  applied: number;
  ignored: number;
  pending: number;
  blocked: number;
  failed: number;
  manifestDigest: string;
  appliedResultDigest: string;
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function operationCountTotal(counts: MigrationApplyCounts) {
  return counts.pending + counts.leased + counts.blocked + counts.applied +
    counts.ignored + counts.failed;
}

function countOnlyApplyWorkspace(workspace: MigrationApplyWorkspace) {
  return {
    runId: workspace.runId,
    runStatus: workspace.runStatus,
    counts: workspace.counts,
    batches: workspace.batches.map((batch) => ({
      id: batch.id,
      status: batch.status,
      manifestDigest: batch.manifestDigest,
      summary: batch.summary,
    })),
  };
}

/**
 * Reconciles immutable manifest categories with durable local apply-operation
 * categories. It intentionally accepts and emits counts and digests only;
 * snapshots, review reasons, source values, and CRM record values never enter
 * operational reconciliation evidence.
 */
export function reconcileMigrationApply(input: {
  manifest: MigrationApplyManifest;
  workspace?: MigrationApplyWorkspace;
}): MigrationApplyReconciliationReport {
  const { manifest, workspace } = input;
  const manifestCounts = manifest.counts;
  const scheduledCounts = workspace?.counts;
  const scheduled = scheduledCounts?.total ?? 0;

  if (
    scheduled < 0 ||
    scheduled > manifestCounts.runnable ||
    (scheduledCounts && operationCountTotal(scheduledCounts) !== scheduled)
  ) {
    throw new Error("Act migration apply workspace counts are inconsistent.");
  }

  const applied = scheduledCounts?.applied ?? 0;
  const ignored = manifestCounts.ignored + (scheduledCounts?.ignored ?? 0);
  const blocked = scheduledCounts?.blocked ?? 0;
  const failed = manifestCounts.failed + (scheduledCounts?.failed ?? 0);
  const pending = manifestCounts.pending + (scheduledCounts?.pending ?? 0) +
    (scheduledCounts?.leased ?? 0) + (manifestCounts.runnable - scheduled);
  const proposalTotal = manifestCounts.reconciled + applied + ignored + pending +
    blocked + failed;

  if (proposalTotal !== manifestCounts.proposalTotal) {
    throw new Error("Act migration apply reconciliation does not cover every proposal.");
  }

  return {
    proposalTotal,
    reconciled: manifestCounts.reconciled,
    approved: manifestCounts.runnable,
    scheduled,
    applied,
    ignored,
    pending,
    blocked,
    failed,
    manifestDigest: manifest.digest,
    appliedResultDigest: digest({
      manifestDigest: manifest.digest,
      workspace: countOnlyApplyWorkspace(workspace ?? {
        runId: "",
        runStatus: "not_scheduled",
        counts: {
          pending: 0,
          leased: 0,
          blocked: 0,
          applied: 0,
          ignored: 0,
          failed: 0,
          total: 0,
        },
        batches: [],
      }),
    }),
  };
}

function countValues<T extends string>(
  values: readonly T[],
  actual: readonly string[],
) {
  return Object.fromEntries(
    values.map((value) => [
      value,
      actual.filter((candidate) => candidate === value).length,
    ]),
  ) as Record<T, number>;
}

function canonicalProposals(proposals: readonly ActMigrationProposal[]) {
  return proposals
    .map((value) => ({
      proposalKey: value.proposalKey,
      state: value.state,
      reviewState: value.reviewState,
      targetEntityType: value.targetEntityType,
      sourceRecordKeys: [...value.sourceRecordKeys].toSorted(),
      candidateLocalIds: [...value.candidateLocalIds].toSorted(),
      proposedLocalId: value.proposedLocalId,
      proposedPrimarySourceId: value.proposedPrimarySourceId,
      duplicateGroupKey: value.duplicateGroupKey ?? null,
      duplicateSourceIds: [...(value.duplicateSourceIds ?? [])].toSorted(),
      issueCode: value.issueCode,
      dependencyProposalKeys: [...value.dependencyProposalKeys].toSorted(),
      matchReason: value.matchReason,
      displaySnapshot: canonicalValue(value.displaySnapshot),
    }))
    .toSorted((left, right) => {
      const keyOrder = left.proposalKey.localeCompare(right.proposalKey);
      return keyOrder || JSON.stringify(left).localeCompare(JSON.stringify(right));
    });
}

export function proposalSnapshotDigest(
  proposals: readonly ActMigrationProposal[],
) {
  return digest(canonicalProposals(proposals));
}

export function reconcileMigrationPreview(input: {
  source: FinalizedSourceSnapshot;
  proposals: readonly ActMigrationProposal[];
}): MigrationReconciliationReport {
  if (
    sourceSnapshotDigest(input.source.records) !== input.source.sourceDigest
  ) {
    throw new Error(
      "Act migration source digest does not match the finalized snapshot.",
    );
  }
  const validRecords = input.source.records.filter(
    ({ errorCode }) => errorCode === null,
  );
  const entityStreams = input.source.records
    .filter(({ streamType }) =>
      (actSourceEntityTypeValues as readonly string[]).includes(streamType),
    )
    .map(({ streamType }) => streamType);
  const relationshipStreams = input.source.records
    .filter(({ streamType }) =>
      (actRelationshipTypeValues as readonly string[]).includes(streamType),
    )
    .map(({ streamType }) => streamType);

  const readyProposal = (value: ActMigrationProposal | undefined) =>
    Boolean(
      value &&
        (value.state === "new" ||
          value.state === "matched_unchanged" ||
          value.state === "change") &&
        (value.issueCode === null || value.issueCode === "needs_person"),
    );
  const resolvedPlaces = input.proposals.filter(
    (value) =>
      value.targetEntityType === "organization" && readyProposal(value),
  );
  const resolvedPeople = input.proposals.filter(
    (value) => value.targetEntityType === "contact" && readyProposal(value),
  );
  const resolvedPlaceKeys = new Set(
    resolvedPlaces.map(({ proposalKey }) => proposalKey),
  );
  const resolvedPersonKeys = new Set(
    resolvedPeople.map(({ proposalKey }) => proposalKey),
  );
  const resolvedPlacePersonRelationships = input.proposals.flatMap((value) => {
    if (
      value.targetEntityType !== "organization_contact" ||
      value.issueCode !== null ||
      !(
        value.state === "new_relationship" ||
        value.state === "matched_unchanged" ||
        value.state === "change"
      )
    ) {
      return [];
    }
    const placeKey = value.dependencyProposalKeys.find((key) =>
      resolvedPlaceKeys.has(key),
    );
    const personKey = value.dependencyProposalKeys.find((key) =>
      resolvedPersonKeys.has(key),
    );
    return placeKey && personKey ? [{ placeKey, personKey }] : [];
  });
  const placesWithPeople = new Set(
    resolvedPlacePersonRelationships.map(({ placeKey }) => placeKey),
  );
  const placesByPerson = new Map<string, Set<string>>();
  for (const { placeKey, personKey } of resolvedPlacePersonRelationships) {
    const places = placesByPerson.get(personKey) ?? new Set<string>();
    places.add(placeKey);
    placesByPerson.set(personKey, places);
  }

  const opportunityRecords = validRecords.filter(
    ({ streamType, sourceId }) =>
      streamType === "opportunity" && sourceId !== null,
  );
  const proposalBySourceKey = new Map<string, ActMigrationProposal>();
  for (const value of input.proposals) {
    for (const sourceKey of value.sourceRecordKeys) {
      proposalBySourceKey.set(sourceKey, value);
    }
  }
  const opportunityBookings = opportunityRecords.map((record) => ({
    record,
    proposal: proposalBySourceKey.get(record.sourceKey),
  }));
  const reliableOpportunityBookings = new Set(
    opportunityBookings.flatMap(({ proposal: value }) =>
      value &&
      value.targetEntityType === "booking" &&
      readyProposal(value) &&
      value.dependencyProposalKeys.some((key) => resolvedPlaceKeys.has(key))
        ? [value.proposalKey]
        : [],
    ),
  );
  const reliableBookingPeople = new Set(
    input.proposals.flatMap((value) => {
      if (
        value.targetEntityType !== "booking_contact" ||
        value.issueCode !== null ||
        !(
          value.state === "new_relationship" ||
          value.state === "matched_unchanged" ||
          value.state === "change"
        ) ||
        !value.dependencyProposalKeys.some((key) =>
          resolvedPersonKeys.has(key),
        )
      ) {
        return [];
      }
      return value.dependencyProposalKeys.filter((key) =>
        reliableOpportunityBookings.has(key),
      );
    }),
  );

  const ownershipCounts = new Map<string, number>();
  for (const sourceKey of input.proposals.flatMap(
    ({ sourceRecordKeys }) => sourceRecordKeys,
  )) {
    ownershipCounts.set(sourceKey, (ownershipCounts.get(sourceKey) ?? 0) + 1);
  }
  const stagedKeys = input.source.records.map(({ sourceKey }) => sourceKey);
  const stagedKeySet = new Set(stagedKeys);
  const proposalKeys = input.proposals.map(({ proposalKey }) => proposalKey);
  const proposalKeySet = new Set(proposalKeys);
  const ownershipComplete =
    stagedKeys.length === stagedKeySet.size &&
    stagedKeys.every((sourceKey) => ownershipCounts.get(sourceKey) === 1) &&
    [...ownershipCounts.keys()].every((sourceKey) =>
      stagedKeySet.has(sourceKey),
    );
  const dependenciesComplete = input.proposals.every(({ dependencyProposalKeys }) =>
    dependencyProposalKeys.every((key) => proposalKeySet.has(key)),
  );
  const proposalKeysUnique = proposalKeys.length === proposalKeySet.size;
  const proposedPrimarySourcesValid = input.proposals.every((value) => {
    if (value.proposedPrimarySourceId === null) return true;
    return value.sourceRecordKeys.some((sourceKey) => {
      const record = input.source.records.find(
        (candidate) => candidate.sourceKey === sourceKey,
      );
      return (
        record?.streamType === "contact" &&
        record.sourceId === value.proposedPrimarySourceId
      );
    });
  });

  const incompleteCheckpoints = input.source.checkpoints.filter(
    ({ status }) => status !== "complete",
  ).length;
  const failedCheckpoints = input.source.checkpoints.filter(
    ({ status }) => status === "failed",
  ).length;

  const automaticReview = autoReviewMigrationProposals(input.proposals);
  return {
    sourceCounts: countValues(actSourceEntityTypeValues, entityStreams),
    relationshipCounts: countValues(
      actRelationshipTypeValues,
      relationshipStreams,
    ),
    previewCounts: countValues(
      migrationPreviewStateValues,
      input.proposals.map(({ state }) => state),
    ),
    placesWithoutPeople: resolvedPlaces.filter(
      ({ proposalKey }) => !placesWithPeople.has(proposalKey),
    ).length,
    multiPlacePeople: [...placesByPerson.values()].filter(
      (places) => places.size > 1,
    ).length,
    opportunitiesWithoutPlace: opportunityBookings.filter(
      ({ proposal: value }) =>
        !value || !reliableOpportunityBookings.has(value.proposalKey),
    ).length,
    opportunitiesWithoutPerson: opportunityBookings.filter(
      ({ proposal: value }) =>
        !value || !reliableBookingPeople.has(value.proposalKey),
    ).length,
    duplicateSourceIdConflicts: input.source.records.filter(
      ({ errorCode }) => errorCode === "duplicate_source_id_conflict",
    ).length,
    incompleteCheckpoints,
    failedCheckpoints,
    autoApproved: automaticReview.approvedProposalKeys.length,
    reviewRequired: automaticReview.pendingProposalKeys.length,
    sourceDigest: input.source.sourceDigest,
    proposalDigest: proposalSnapshotDigest(input.proposals),
    complete:
      input.source.checkpoints.length > 0 &&
      incompleteCheckpoints === 0 &&
      failedCheckpoints === 0 &&
      ownershipComplete &&
      dependenciesComplete &&
      proposalKeysUnique &&
      proposedPrimarySourcesValid,
  };
}
