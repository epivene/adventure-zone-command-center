import {
  type ActMigrationPreviewRepository,
  type MigrationPreviewQuery,
  type StoredMigrationPreviewPage,
} from "@/features/act-migration/preview-repository";
import type { LocalCandidateRepository } from "@/features/act-migration/local-candidate-repository";
import { buildMigrationProposals } from "@/features/act-migration/matcher";
import {
  groupExactPlaceDuplicates,
  normalizePlaceIdentity,
  type PlaceIdentityRow,
} from "@/features/act-migration/place-identity";
import {
  reconcileMigrationPreview,
} from "@/features/act-migration/reconciliation";
import {
  autoReviewMigrationProposals,
} from "@/features/act-migration/auto-review";
import type { ActMigrationSnapshotRepository } from "@/features/act-migration/snapshot-repository";
import type {
  ActMigrationProposal,
  MigrationDecision,
} from "@/features/act-migration/migration-types";
import type { BulkReviewScope } from "@/features/act-migration/bulk-review";
import type { FinalizedSourceSnapshot } from "@/features/act-migration/snapshot-repository";

const DEFAULT_QUERY: MigrationPreviewQuery = { page: 1, pageSize: 50 };

type StagedCompany = PlaceIdentityRow & {
  sourceKey: string;
};

type StagedRecord = FinalizedSourceSnapshot["records"][number];

function uniqueJson(values: readonly string[]) {
  return JSON.stringify([
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].toSorted());
}

function snapshotText(record: StagedRecord, key: string) {
  const value = record.normalizedSnapshot[key] ?? record.rawSnapshot[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Retain the deduplicated profile evidence represented by an exact-place
 * group. The canonical proposal remains scalar for apply compatibility while
 * its owner-only preview includes every unique source value and source ID.
 */
function mergedEventProfileHistory(
  source: FinalizedSourceSnapshot,
  companySourceIds: readonly string[],
) {
  const companyIds = new Set(companySourceIds);
  const companyContacts = source.records.filter((record) =>
    record.streamType === "company_contact" &&
    record.sourceId !== null &&
    companyIds.has(record.sourceId) &&
    record.targetSourceId !== null,
  );
  const contactIds = new Set(companyContacts.flatMap((record) =>
    record.targetSourceId ? [record.targetSourceId] : [],
  ));
  const bookingIds = new Set(source.records.flatMap((record) =>
    record.streamType === "opportunity_company" &&
    record.targetSourceId !== null &&
    companyIds.has(record.targetSourceId)
      ? [record.sourceId]
      : [],
  ));
  const groupIds = new Set(source.records.flatMap((record) =>
    record.streamType === "group_contact" &&
    record.targetSourceId !== null &&
    contactIds.has(record.targetSourceId)
      ? [record.sourceId]
      : [],
  ));
  const relatedRecords = source.records.filter((record) =>
    (record.streamType === "company" && record.sourceId !== null && companyIds.has(record.sourceId)) ||
    (record.streamType === "contact" && record.sourceId !== null && contactIds.has(record.sourceId)) ||
    (record.streamType === "opportunity" && record.sourceId !== null && bookingIds.has(record.sourceId)),
  );
  const phones = relatedRecords.flatMap((record) => {
    const phone = snapshotText(record, "phone");
    return phone ? [phone] : [];
  });
  const notes = relatedRecords.flatMap((record) =>
    ["notes", "note"].flatMap((key) => {
      const note = snapshotText(record, key);
      return note ? [note] : [];
    }),
  );
  return {
    mergedContactSourceIds: uniqueJson([...contactIds]),
    mergedPhones: uniqueJson(phones),
    mergedNotes: uniqueJson(notes),
    mergedBookingSourceIds: uniqueJson([...bookingIds].filter((id): id is string => id !== null)),
    mergedGroupSourceIds: uniqueJson([...groupIds].filter((id): id is string => id !== null)),
  };
}

function stagedCompanies(source: FinalizedSourceSnapshot): StagedCompany[] {
  return source.records.flatMap((record) => {
    if (
      record.streamType !== "company" ||
      record.errorCode !== null ||
      record.sourceId === null
    ) {
      return [];
    }
    const snapshot = record.normalizedSnapshot as {
      displayName?: unknown;
      address1?: unknown;
      address2?: unknown;
      city?: unknown;
      region?: unknown;
      postalCode?: unknown;
    };
    if (typeof snapshot.displayName !== "string") return [];
    const location = [
      snapshot.address1,
      snapshot.address2,
      snapshot.city,
      snapshot.region,
      snapshot.postalCode,
    ].filter((value): value is string => typeof value === "string").join(" ");
    return [{
      sourceId: record.sourceId,
      sourceKey: record.sourceKey,
      name: snapshot.displayName,
      location: location || null,
    }];
  });
}

function consolidateExactDuplicatePlaces(input: {
  source: FinalizedSourceSnapshot;
  proposals: readonly ActMigrationProposal[];
}): readonly ActMigrationProposal[] {
  const groups = groupExactPlaceDuplicates(stagedCompanies(input.source));
  const mergedByProposalKey = new Map<string, {
    groupKey: string;
    sourceIds: string[];
    sourceRecordKeys: string[];
  }>();
  const canonicalKeyByProposalKey = new Map<string, string>();

  for (const [groupKey, rows] of groups) {
    // A missing location is a near-match signal, never an automatic merge.
    if (rows.length < 2 || !normalizePlaceIdentity(rows[0]!).location) continue;
    const sourceIds = rows.map(({ sourceId }) => sourceId).toSorted();
    const proposalKeys = rows.map(({ sourceKey }) => `organization:${sourceKey}`);
    const groupProposals = proposalKeys.map((proposalKey) =>
      input.proposals.find((proposal) => proposal.proposalKey === proposalKey),
    );
    if (groupProposals.some((proposal) => proposal === undefined)) continue;
    const canonicalProposalKey = `organization:company:${sourceIds[0]}`;
    const canonicalProposal = input.proposals.find(
      ({ proposalKey }) => proposalKey === canonicalProposalKey,
    );
    if (!canonicalProposal) continue;
    const sourceRecordKeys = groupProposals.flatMap(
      (proposal) => proposal!.sourceRecordKeys,
    ).toSorted();
    mergedByProposalKey.set(canonicalProposalKey, {
      groupKey,
      sourceIds,
      sourceRecordKeys,
    });
    for (const proposalKey of proposalKeys) {
      canonicalKeyByProposalKey.set(proposalKey, canonicalProposalKey);
    }
  }

  const remapped = input.proposals.flatMap((proposal) => {
    const canonicalProposalKey = canonicalKeyByProposalKey.get(proposal.proposalKey);
    if (canonicalProposalKey && canonicalProposalKey !== proposal.proposalKey) {
      return [];
    }
    const merged = mergedByProposalKey.get(proposal.proposalKey);
    return [{
      ...proposal,
      ...(merged
        ? {
            sourceRecordKeys: merged.sourceRecordKeys,
            duplicateGroupKey: merged.groupKey,
            duplicateSourceIds: merged.sourceIds,
            matchReason: "exact_normalized_place_duplicate_group",
            displaySnapshot: {
              ...proposal.displaySnapshot,
              ...mergedEventProfileHistory(input.source, merged.sourceIds),
            },
          }
        : {}),
      dependencyProposalKeys: proposal.dependencyProposalKeys.map(
        (key) => canonicalKeyByProposalKey.get(key) ?? key,
      ).toSorted(),
    }];
  });
  const relationshipGroups = Map.groupBy(
    remapped.filter((proposal) =>
      proposal.targetEntityType === "organization_contact" &&
      proposal.state === "new_relationship" &&
      proposal.issueCode === null,
    ),
    (proposal) => `${proposal.targetEntityType}|${proposal.dependencyProposalKeys.join("|")}`,
  );
  const canonicalRelationshipKeys = new Map<string, string>();
  const mergedRelationships = new Map<string, ActMigrationProposal>();
  for (const relationships of relationshipGroups.values()) {
    if (relationships.length < 2) continue;
    const canonical = [...relationships].toSorted((left, right) =>
      left.proposalKey.localeCompare(right.proposalKey),
    )[0]!;
    const sourceRecordKeys = relationships.flatMap((proposal) => proposal.sourceRecordKeys)
      .filter((key, index, values) => values.indexOf(key) === index)
      .toSorted();
    mergedRelationships.set(canonical.proposalKey, {
      ...canonical,
      sourceRecordKeys,
    });
    for (const relationship of relationships) {
      canonicalRelationshipKeys.set(relationship.proposalKey, canonical.proposalKey);
    }
  }
  return remapped.flatMap((proposal) => {
    const canonicalKey = canonicalRelationshipKeys.get(proposal.proposalKey);
    if (canonicalKey && canonicalKey !== proposal.proposalKey) return [];
    return [mergedRelationships.get(proposal.proposalKey) ?? proposal];
  });
}

export class ActMigrationPreviewService {
  constructor(
    private readonly snapshots: ActMigrationSnapshotRepository,
    private readonly localCandidates: LocalCandidateRepository,
    private readonly previews: ActMigrationPreviewRepository,
  ) {}

  async finalizePreview(
    runId: string,
    query: MigrationPreviewQuery = DEFAULT_QUERY,
  ): Promise<{ preview: StoredMigrationPreviewPage; changed: boolean }> {
    const stored = await this.previews.getPreviewIfStored(runId, query);
    if (stored) return { preview: stored, changed: false };

    const source = await this.snapshots.finalizeSourceSnapshot(runId);
    const local = await this.localCandidates.loadCandidateSnapshot();
    const consolidated = consolidateExactDuplicatePlaces({
      source,
      proposals: buildMigrationProposals({ source, local }),
    });
    const automaticReview = autoReviewMigrationProposals(consolidated);
    const proposals = automaticReview.proposals;
    const report = reconcileMigrationPreview({ source, proposals });
    const storedResult = await this.previews.storeProposalsIfAbsent({
      runId,
      sourceDigest: source.sourceDigest,
      proposalDigest: report.proposalDigest,
      proposals,
      automaticApprovalProposalKeys: automaticReview.approvedProposalKeys,
      report,
    });
    return {
      preview: await this.previews.getPreview(runId, query),
      changed: storedResult.changed,
    };
  }

  getPreview(runId: string, query: MigrationPreviewQuery) {
    return this.previews.getPreview(runId, query);
  }

  saveDecision(input: {
    runId: string;
    proposalKey: string;
    decision: MigrationDecision;
    chosenLocalEntityId?: string;
    primarySourceId?: string;
    ignoreReason?: string;
    decidedBy: string;
  }) {
    return this.previews.saveDecision(input);
  }

  saveBulkDecision(input: BulkReviewScope) {
    return this.previews.saveBulkDecision(input);
  }
}
