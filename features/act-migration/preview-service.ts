import {
  type ActMigrationPreviewRepository,
  type MigrationPreviewQuery,
  type StoredMigrationPreviewPage,
} from "@/features/act-migration/preview-repository";
import type { LocalCandidateRepository } from "@/features/act-migration/local-candidate-repository";
import { buildMigrationProposals } from "@/features/act-migration/matcher";
import {
  reconcileMigrationPreview,
} from "@/features/act-migration/reconciliation";
import type { ActMigrationSnapshotRepository } from "@/features/act-migration/snapshot-repository";
import type { MigrationDecision } from "@/features/act-migration/migration-types";
import type { BulkReviewScope } from "@/features/act-migration/bulk-review";

const DEFAULT_QUERY: MigrationPreviewQuery = { page: 1, pageSize: 50 };

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
    const proposals = buildMigrationProposals({ source, local });
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
