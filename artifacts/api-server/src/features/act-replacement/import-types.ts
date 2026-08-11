export const actReplacementStreamTypes = [
  "company",
  "contact",
  "opportunity",
  "group",
  "company_contact",
  "opportunity_company",
  "opportunity_contact",
  "group_contact",
  "activity",
  "note",
  "history",
  "activity_contact",
  "activity_company",
  "activity_opportunity",
  "note_contact",
  "note_company",
  "note_opportunity",
  "history_contact",
  "history_company",
  "history_opportunity",
] as const;
export type ActReplacementStreamType =
  (typeof actReplacementStreamTypes)[number];

export const actRootStreamTypes = [
  "company",
  "contact",
  "opportunity",
  "group",
  "activity",
  "note",
  "history",
] as const;
export type ActRootStreamType = (typeof actRootStreamTypes)[number];

export const actReplacementOutcomeStates = [
  "pending",
  "leased",
  "ready",
  "already_present",
  "awaiting_review",
  "unassigned",
  "unsupported",
  "ignored",
  "applied",
  "failed",
] as const;
export type ActReplacementOutcomeState =
  (typeof actReplacementOutcomeStates)[number];

export const actLocalEntityTypes = [
  "organization",
  "contact",
  "booking",
  "calling_list",
  "activity",
] as const;
export type ActLocalEntityType = (typeof actLocalEntityTypes)[number];

export const actApplyTargetTypes = [
  ...actLocalEntityTypes,
  "organization_contact",
  "booking_contact",
  "calling_list_member",
  "activity_association",
] as const;
export type ActApplyTargetType = (typeof actApplyTargetTypes)[number];

export const actApplyActions = [
  "create",
  "link_existing",
  "fill_missing",
  "overwrite_reviewed",
  "create_relationship",
  "record_provenance",
] as const;
export type ActApplyAction = (typeof actApplyActions)[number];

export const actOperationExecutionStates = [
  "pending",
  "leased",
  "applied",
  "already_present",
  "blocked",
  "failed",
] as const;
export type ActOperationExecutionState =
  (typeof actOperationExecutionStates)[number];

export const actReviewDecisionScopes = [
  "duplicate_identity",
  "field_conflict",
  "relationship",
  "unsupported_record",
] as const;
export type ActReviewDecisionScope = (typeof actReviewDecisionScopes)[number];

export const actReviewDecisions = [
  "link_existing",
  "keep_separate",
  "keep_local",
  "use_source",
  "assign_parent",
  "keep_unlinked",
  "ignore_source",
] as const;
export type ActReviewDecision = (typeof actReviewDecisions)[number];

export const actReplacementRunPhases = [
  "extracting",
  "extract_complete",
  "organizing",
  "ready_to_apply",
  "applying",
  "complete",
  "complete_with_issues",
  "failed",
  "superseded",
] as const;
export type ActReplacementRunPhase = (typeof actReplacementRunPhases)[number];

export const actCheckpointKinds = [
  "list",
  "plain_list_fallback",
  "detail",
  "relationship",
] as const;
export type ActCheckpointKind = (typeof actCheckpointKinds)[number];

export const actCheckpointRequirednesses = [
  "required",
  "optional_capability",
] as const;
export type ActCheckpointRequiredness =
  (typeof actCheckpointRequirednesses)[number];

export const actCheckpointStates = [
  "pending",
  "leased",
  "retry_wait",
  "complete",
  "unsupported",
  "failed",
] as const;
export type ActCheckpointState = (typeof actCheckpointStates)[number];

export const actQueryModes = ["projected", "plain"] as const;
export type ActQueryMode = (typeof actQueryModes)[number];

export const actArchiveCompletenessValues = [
  "discovered",
  "complete",
  "partial",
  "failed",
] as const;
export type ActArchiveCompleteness =
  (typeof actArchiveCompletenessValues)[number];

export const actSnapshotScopes = [
  "list_projected",
  "list_plain",
  "detail",
  "relationship",
] as const;
export type ActSnapshotScope = (typeof actSnapshotScopes)[number];

export const actRequestAuditStates = [
  "started",
  "succeeded",
  "failed",
] as const;
export type ActRequestAuditState = (typeof actRequestAuditStates)[number];

export const actSafeErrorCodes = [
  "not_configured",
  "authentication_failed",
  "permission_denied",
  "query_rejected",
  "not_found",
  "endpoint_unsupported",
  "rate_limited",
  "timeout",
  "unavailable",
  "invalid_response",
  "pagination_stalled",
] as const;
export type ActSafeErrorCode = (typeof actSafeErrorCodes)[number];

export type StartActReplacementRun = {
  requestKey: string;
  sourceDatabaseKey: string;
  requestedBy: string;
  pageSize: 25 | 50 | 100 | 200;
};

export type DerivedCheckpointSpec = {
  streamType: ActReplacementStreamType;
  checkpointKind: Exclude<ActCheckpointKind, "list">;
  partitionKey: string;
  requiredness: ActCheckpointRequiredness;
  parentSourceRecordId: string | null;
  parentActRecordId: string | null;
  sourceRecordId: string | null;
  nextSkip: number;
  pageSize: number;
  queryMode: ActQueryMode;
  deriveDetails: boolean;
};

export type ClaimedCheckpoint = DerivedCheckpointSpec & {
  id: string;
  runId: string;
  sourceDatabaseKey: string;
  leaseOwner: string;
  attemptCount: number;
};

export type CheckpointFailure = {
  checkpointId: string;
  leaseOwner: string;
  errorCode: ActSafeErrorCode;
  retryable: boolean;
  retryAfter: Date | null;
  now: Date;
};

export type ActExtractionCounters = {
  responseRows: number;
  observedIdentities: number;
  archivedIdentities: number;
  completeIdentities: number;
  partialIdentities: number;
  failedIdentities: number;
  snapshotVersionsInserted: number;
};

export type ImportWorkflow = {
  safeOperationCount: number;
  autoResolvedCount: number;
  archivedOnlyCount: number;
  reviewRequiredCount: number;
  appliedOperationCount: number;
  alreadyPresentOperationCount: number;
  blockedOperationCount: number;
  failedOperationCount: number;
  manifestDigest: string | null;
  nextApplyCursor: number;
  canOrganize: boolean;
  canReview: boolean;
  canApplySafe: boolean;
  requiredStreams: string[];
  leaseSummary: { active: number; expired: number };
  operations: Array<{
    operationKey: string;
    sourceVersionId: string | null;
    targetType: string;
    status:
      | "pending"
      | "leased"
      | "applied"
      | "already_present"
      | "blocked"
      | "failed";
    requiredForSourceOutcome: boolean;
    heldForReview: boolean;
    dependencyOperationKeys: string[];
    safeByDefault: boolean;
  }>;
  applyBatches: Array<{ state: string }>;
  durableAdapters: { reviewReader: boolean; commandService: boolean; applyRepository: boolean };
};

export type ActReplacementStatus = {
  runId: string;
  phase: ActReplacementRunPhase;
  previewOnly: boolean;
  pageSize: 25 | 50 | 100 | 200;
  streams: Array<
    ActExtractionCounters & {
      streamType: ActReplacementStreamType;
      state: ActCheckpointState | "mixed";
      completedCheckpoints: number;
      totalCheckpoints: number;
      queryMode: ActQueryMode | "mixed";
      lastSucceededAt: string | null;
      error: {
        code: ActSafeErrorCode;
        retryable: boolean;
        retryAfter: string | null;
      } | null;
    }
  >;
  allStreams: ActExtractionCounters & { unsupportedCapabilities: number };
  canResume: boolean;
  canStartOver: boolean;
};

export type ActReplacementWorkflowStatus = ActReplacementStatus &
  ImportWorkflow;
