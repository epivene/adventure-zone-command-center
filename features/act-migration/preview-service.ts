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

  return input.proposals.flatMap((proposal) => {
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
          }
        : {}),
      dependencyProposalKeys: proposal.dependencyProposalKeys.map(
        (key) => canonicalKeyByProposalKey.get(key) ?? key,
      ).toSorted(),
    }];
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
    const proposals = consolidateExactDuplicatePlaces({
      source,
      proposals: buildMigrationProposals({ source, local }),
    });
    const report = reconcileMigrationPreview({ source, proposals });
    const storedResult = await this.previews.storeProposalsIfAbsent({
      runId,
      sourceDigest: source.sourceDigest,
      proposalDigest: report.proposalDigest,
      proposals,
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
