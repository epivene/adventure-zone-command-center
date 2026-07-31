import type {
  ActMigrationProposal,
  MigrationDecision,
  MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";

export type MigrationApplyProposal = ActMigrationProposal & {
  decision: MigrationDecision | null;
  chosenLocalEntityId: string | null;
  primarySourceId: string | null;
};

export type MigrationStableLink = {
  targetEntityType: MigrationTargetEntityType;
  localEntityId: string;
  sourceRecordKey: string;
};

export type MigrationApplyManifestInput = {
  /** Digest recomputed from the finalized source snapshot selected for apply. */
  sourceDigest: string;
  /** Source digest recorded when the immutable preview was stored. */
  previewSourceDigest: string;
  /** Proposal digest recorded when the immutable preview was stored. */
  previewProposalDigest: string;
  proposals: readonly MigrationApplyProposal[];
  stableLinks: readonly MigrationStableLink[];
  /** Dependencies completed by a prior batch, rather than this manifest. */
  resolvedProposalKeys?: readonly string[];
};

export type MigrationApplyManifestEntry = {
  proposalKey: string;
  /** The reviewed proposal that owns the canonical local target. */
  canonicalTargetProposalKey: string;
  /** A reviewed existing/local target when it is already known. */
  canonicalTargetLocalEntityId: string | null;
  /** All source IDs represented by an exact duplicate-place group. */
  canonicalSourceIds: readonly string[];
  decision: MigrationDecision;
  chosenLocalEntityId: string | null;
  primarySourceId: string | null;
  targetEntityType: MigrationTargetEntityType;
  sourceRecordKeys: readonly string[];
  dependencyProposalKeys: readonly string[];
  operationRank: number;
};

export type MigrationApplyTargetCounts = {
  runnable: number;
  reconciled: number;
  ignored: number;
  pending: number;
  failed: number;
};

export type MigrationApplyCounts = MigrationApplyTargetCounts & {
  proposalTotal: number;
  byTarget: Record<MigrationTargetEntityType, MigrationApplyTargetCounts>;
};

export type MigrationApplyManifest = {
  sourceDigest: string;
  previewProposalDigest: string;
  entries: readonly MigrationApplyManifestEntry[];
  counts: MigrationApplyCounts;
  digest: string;
};
