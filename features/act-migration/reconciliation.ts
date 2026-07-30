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
import type { FinalizedSourceSnapshot } from "@/features/act-migration/snapshot-repository";

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
  sourceDigest: string;
  proposalDigest: string;
  complete: boolean;
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

function canonicalSource(source: FinalizedSourceSnapshot) {
  return source.records
    .map((record) => ({
      streamType: record.streamType,
      sourceKey: record.sourceKey,
      sourceId: record.sourceId,
      targetSourceId: record.targetSourceId,
      rawSnapshot: canonicalValue(record.rawSnapshot),
      normalizedSnapshot: canonicalValue(record.normalizedSnapshot),
      fingerprint: record.fingerprint,
      errorCode: record.errorCode,
      errorFields: [...record.errorFields].toSorted(),
    }))
    .toSorted((left, right) => {
      const leftIdentity = `${left.streamType}\0${left.sourceKey}\0${left.fingerprint}`;
      const rightIdentity = `${right.streamType}\0${right.sourceKey}\0${right.fingerprint}`;
      return leftIdentity.localeCompare(rightIdentity);
    });
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

export function reconcileMigrationPreview(input: {
  source: FinalizedSourceSnapshot;
  proposals: readonly ActMigrationProposal[];
}): MigrationReconciliationReport {
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

  const companyIds = new Set(
    validRecords
      .filter(({ streamType, sourceId }) => streamType === "company" && sourceId)
      .map(({ sourceId }) => sourceId!),
  );
  const contactIds = new Set(
    validRecords
      .filter(({ streamType, sourceId }) => streamType === "contact" && sourceId)
      .map(({ sourceId }) => sourceId!),
  );
  const opportunityIds = new Set(
    validRecords
      .filter(
        ({ streamType, sourceId }) =>
          streamType === "opportunity" && sourceId,
      )
      .map(({ sourceId }) => sourceId!),
  );
  const companyContactEdges = validRecords.filter(
    ({ streamType, sourceId, targetSourceId }) =>
      streamType === "company_contact" &&
      sourceId !== null &&
      targetSourceId !== null,
  );
  const opportunityCompanyEdges = validRecords.filter(
    ({ streamType, sourceId, targetSourceId }) =>
      streamType === "opportunity_company" &&
      sourceId !== null &&
      targetSourceId !== null,
  );
  const opportunityContactEdges = validRecords.filter(
    ({ streamType, sourceId, targetSourceId }) =>
      streamType === "opportunity_contact" &&
      sourceId !== null &&
      targetSourceId !== null,
  );

  const companiesWithPeople = new Set(
    companyContactEdges
      .filter(
        ({ sourceId, targetSourceId }) =>
          companyIds.has(sourceId!) && contactIds.has(targetSourceId!),
      )
      .map(({ sourceId }) => sourceId!),
  );
  const placesByPerson = new Map<string, Set<string>>();
  for (const edge of companyContactEdges) {
    if (
      !companyIds.has(edge.sourceId!) ||
      !contactIds.has(edge.targetSourceId!)
    ) {
      continue;
    }
    const places = placesByPerson.get(edge.targetSourceId!) ?? new Set<string>();
    places.add(edge.sourceId!);
    placesByPerson.set(edge.targetSourceId!, places);
  }
  const opportunitiesWithPlace = new Set(
    opportunityCompanyEdges
      .filter(
        ({ sourceId, targetSourceId }) =>
          opportunityIds.has(sourceId!) && companyIds.has(targetSourceId!),
      )
      .map(({ sourceId }) => sourceId!),
  );
  const opportunitiesWithPerson = new Set(
    opportunityContactEdges
      .filter(
        ({ sourceId, targetSourceId }) =>
          opportunityIds.has(sourceId!) && contactIds.has(targetSourceId!),
      )
      .map(({ sourceId }) => sourceId!),
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
    placesWithoutPeople: [...companyIds].filter(
      (sourceId) => !companiesWithPeople.has(sourceId),
    ).length,
    multiPlacePeople: [...placesByPerson.values()].filter(
      (places) => places.size > 1,
    ).length,
    opportunitiesWithoutPlace: [...opportunityIds].filter(
      (sourceId) => !opportunitiesWithPlace.has(sourceId),
    ).length,
    opportunitiesWithoutPerson: [...opportunityIds].filter(
      (sourceId) => !opportunitiesWithPerson.has(sourceId),
    ).length,
    duplicateSourceIdConflicts: input.source.records.filter(
      ({ errorCode }) => errorCode === "duplicate_source_id_conflict",
    ).length,
    incompleteCheckpoints,
    failedCheckpoints,
    sourceDigest: digest(canonicalSource(input.source)),
    proposalDigest: digest(canonicalProposals(input.proposals)),
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
