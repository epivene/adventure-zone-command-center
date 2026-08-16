export type RecoveryState =
  | "pending"
  | "leased"
  | "already_present"
  | "recovered"
  | "needs_review"
  | "dropped_unusable"
  | "retryable_failed";

export type RecoveryTerminalState = Exclude<RecoveryState, "pending" | "leased" | "retryable_failed">;

export type RecoveryCandidate = {
  itemId: string;
  runId: string;
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: string;
  actRecordId: string | null;
  rawSnapshot: Record<string, unknown>;
  relationshipEvidence: Record<string, unknown>;
  /** Durable archive capture time used only when ACT has no usable source date. */
  capturedAt?: string;
  leaseToken: string;
};

export type RecoveryRunStatus = {
  runId: string;
  state: "running" | "complete" | "failed";
  candidateCount: number;
  pending: number;
  leased: number;
  alreadyPresent: number;
  recovered: number;
  needsReview: number;
  droppedUnusable: number;
  retryableFailed: number;
};

export type RecoveryReviewItem = {
  itemId: string;
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: string;
  actRecordId: string | null;
  rawSnapshot: Record<string, unknown>;
  relationshipEvidence: Record<string, unknown>;
  targetSummary: Record<string, unknown>;
};
