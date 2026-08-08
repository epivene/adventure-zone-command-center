import { apiFetch } from "@/lib/auth-token";

export const ACT_PAGE_SIZES = [25, 50, 100, 200] as const;
export type ActPageSize = (typeof ACT_PAGE_SIZES)[number];
export type ActReplacementPhase =
  | "extracting"
  | "extract_complete"
  | "organizing"
  | "ready_to_apply"
  | "applying"
  | "complete"
  | "complete_with_issues"
  | "failed"
  | "superseded";
export type ActSafeErrorCode =
  | "not_configured"
  | "authentication_failed"
  | "permission_denied"
  | "query_rejected"
  | "not_found"
  | "endpoint_unsupported"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "pagination_stalled";

export type ActReplacementStatus = {
  runId: string;
  phase: ActReplacementPhase;
  previewOnly: boolean;
  pageSize: ActPageSize;
  streams: Array<{
    streamType: string;
    state: string;
    completedCheckpoints: number;
    totalCheckpoints: number;
    queryMode: string;
    lastSucceededAt: string | null;
    error: {
      code: ActSafeErrorCode;
      retryable: boolean;
      retryAfter: string | null;
    } | null;
    responseRows: number;
    observedIdentities: number;
    archivedIdentities: number;
    completeIdentities: number;
    partialIdentities: number;
    failedIdentities: number;
    snapshotVersionsInserted: number;
  }>;
  allStreams: {
    responseRows: number;
    observedIdentities: number;
    archivedIdentities: number;
    completeIdentities: number;
    partialIdentities: number;
    failedIdentities: number;
    snapshotVersionsInserted: number;
    unsupportedCapabilities: number;
  };
  canResume: boolean;
  canStartOver: boolean;
};

export type ActReplacementWorkflowStatus = ActReplacementStatus & {
  safeOperationCount: number;
  reviewRequiredCount: number;
  appliedOperationCount: number;
  alreadyPresentOperationCount: number;
  blockedOperationCount: number;
  failedOperationCount: number;
  manifestDigest: string | null;
  nextApplyCursor: number;
  canOrganize: boolean;
  canApplySafe: boolean;
};

export type ImportManifest = {
  digest: string;
  diagnostics?: Array<{ code: string; sourceRecordId: string; path?: string }>;
  outcomes?: Array<{
    sourceRecordId: string;
    sourceVersionId: string;
    state: string;
    issueCodes: string[];
    operationKeys: string[];
  }>;
  operations?: Array<{
    operationKey: string;
    sourceRecordId: string;
    sourceVersionId: string;
    targetType: string;
    action: string;
    dependencyOperationKeys: string[];
    requiredForSourceOutcome: boolean;
    safeByDefault: boolean;
  }>;
};

export type OrganizeResponse = {
  status: string;
  manifest: ImportManifest;
};

export type ReviewDisplayValue = string | number | boolean | null;
export type ReviewRow = {
  sourceRecordId: string;
  sourceVersionId: string;
  state: string;
  issueCodes: string[];
  operationKeys: string[];
  streamType?: string;
  display: Record<string, ReviewDisplayValue>;
};
export type ReviewPage = {
  page: number;
  pageSize: ActPageSize;
  total: number;
  manifestDigest: string | null;
  rows: ReviewRow[];
};

export type ApprovalClosure = {
  selectedOperationIds: string[];
  approvedOperationIds: string[];
  dependencyOperationIds: string[];
  rejectedOperationIds: string[];
  selectedCount: number;
  dependencyCount: number;
  rejectedCount: number;
  manifestDigest: string;
};

export type ApplyNextRequest = {
  expectedManifestDigest: string;
  approvalRequestKey: string;
  batchSize: number;
  retryFailed?: boolean;
};
export type ApplyNextResponse = {
  batch: {
    batchId: string;
    runId: string;
    manifestDigest: string;
    state: "queued" | "applying" | "complete" | "complete_with_issues";
    operationCount: number;
    completedCount: number;
    alreadyPresentCount: number;
    blockedCount: number;
    failedCount: number;
  };
  nextCursor: number;
  hasMore: boolean;
  requiresReview: boolean;
};

export type ReviewDecision = {
  id: string;
  sourceRecordId: string;
  sourceVersionId: string;
  scope: "duplicate_identity" | "field_conflict" | "unsupported_record";
  decision:
    | "link_existing"
    | "keep_separate"
    | "keep_local"
    | "use_source"
    | "ignore_source";
  active: boolean;
};

export class ActReplacementApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "ActReplacementApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code =
      typeof payload?.code === "string"
        ? payload.code
        : `API ${response.status}`;
    throw new ActReplacementApiError(code, response.status);
  }
  return payload as T;
}

type WorkflowResponse = { run: ActReplacementWorkflowStatus };

export const getLatestRun = () =>
  request<{ run: ActReplacementWorkflowStatus | null }>(
    "/migration/act-replacement/runs/latest",
  );
export const getRun = (runId: string) =>
  request<WorkflowResponse>(
    `/migration/act-replacement/runs/${encodeURIComponent(runId)}`,
  );
export const startRun = (
  pageSize: ActPageSize,
  requestKey: string = crypto.randomUUID(),
) =>
  request<{ created: boolean; run: ActReplacementWorkflowStatus }>(
    "/migration/act-replacement/runs",
    {
      method: "POST",
      body: JSON.stringify({ requestKey, pageSize }),
    },
  );
export const resumeRun = (runId: string) =>
  request<WorkflowResponse>(
    `/migration/act-replacement/runs/${encodeURIComponent(runId)}/resume`,
    { method: "POST", body: "{}" },
  );
export const supersedeRun = (runId: string) =>
  request<WorkflowResponse>(
    `/migration/act-replacement/runs/${encodeURIComponent(runId)}/supersede`,
    {
      method: "POST",
      body: JSON.stringify({ confirm: "START OVER" }),
    },
  );
export const organizeRun = (runId: string) =>
  request<OrganizeResponse>(
    `/migration/act-replacement/runs/${encodeURIComponent(runId)}/organize`,
    { method: "POST", body: "{}" },
  );
export const getReview = (
  runId: string,
  query: {
    page?: number;
    pageSize?: ActPageSize;
    search?: string;
    state?: string;
    issue?: string;
  } = {},
) => {
  const params = new URLSearchParams({
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? 25),
  });
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.state) params.set("state", query.state);
  if (query.issue) params.set("issue", query.issue);
  return request<ReviewPage>(
    `/migration/act-replacement/runs/${encodeURIComponent(runId)}/review?${params.toString()}`,
  );
};
export const approveSafeDefaults = (
  runId: string,
  expectedManifestDigest: string,
  requestKey: string = crypto.randomUUID(),
) =>
  request<ApprovalClosure>(
    `/migration/act-replacement/runs/${encodeURIComponent(runId)}/approvals/safe-defaults`,
    {
      method: "POST",
      body: JSON.stringify({ expectedManifestDigest, requestKey }),
    },
  );
export const decideReviewRecord = (
  runId: string,
  sourceRecordId: string,
  body: {
    sourceVersionId: string;
    scope: ReviewDecision["scope"];
    decision: ReviewDecision["decision"];
    fieldName?: string | null;
    targetEntityType?: string | null;
    targetEntityId?: string | null;
    requestKey?: string;
  },
) =>
  request<ReviewDecision>(
    `/migration/act-replacement/source-records/${encodeURIComponent(sourceRecordId)}/decisions`,
    {
      method: "POST",
      body: JSON.stringify({
        runId,
        ...body,
        requestKey: body.requestKey ?? crypto.randomUUID(),
      }),
    },
  );
export const applyNext = (runId: string, body: ApplyNextRequest) =>
  request<ApplyNextResponse>(
    `/migration/act-replacement/runs/${encodeURIComponent(runId)}/apply-next`,
    { method: "POST", body: JSON.stringify(body) },
  );
