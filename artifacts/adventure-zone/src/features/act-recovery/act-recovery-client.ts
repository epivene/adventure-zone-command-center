import { apiFetch, apiGet, apiPost } from "@/lib/auth-token";

export type RecoveryStreamCounts = {
  candidateCount: number;
  pending: number;
  leased: number;
  alreadyPresent: number;
  recovered: number;
  needsReview: number;
  droppedUnusable: number;
  retryableFailed: number;
};

export type ActRecoveryStatus = RecoveryStreamCounts & {
  runId: string;
  sourceDatabaseKey: string;
  state: "running" | "complete" | "failed";
  checkedCount: number;
  complete: boolean;
  byStreamType: Record<string, RecoveryStreamCounts>;
};

export type ActRecoveryReviewItem = {
  itemId: string;
  runId: string;
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: string;
  actRecordId: string | null;
  rawSnapshot: Record<string, unknown>;
  relationshipEvidence: Record<string, unknown>;
  targetSummary: Record<string, unknown>;
};

export type ActRecoveryReviewPage = {
  page: number;
  pageSize: number;
  items: ActRecoveryReviewItem[];
};

export type ActRecoveryCleanupRetrySummary = {
  reviewed: number;
  droppedLinkedTo: number;
  retried: number;
};

export type RecoveryProfileSearchResult = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  const code = typeof body.error === "string" ? body.error : `API ${response.status}`;
  return Object.assign(new Error(code), { code, status: response.status });
}

export async function getRecoveryStatus(): Promise<ActRecoveryStatus | null> {
  const response = await apiFetch("/act-recovery/status");
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<ActRecoveryStatus>;
}

export function startRecovery(): Promise<ActRecoveryStatus> {
  return apiPost<ActRecoveryStatus>("/act-recovery/runs", {
    requestKey: "archive-full-recovery-v3-history-html-text",
  });
}

export function startOwnershipRepair(): Promise<ActRecoveryStatus> {
  return apiPost<ActRecoveryStatus>("/act-recovery/ownership-repair", {});
}

export function getRecoveryReview(page = 1): Promise<ActRecoveryReviewPage> {
  return apiGet<ActRecoveryReviewPage>(`/act-recovery/review?page=${page}&pageSize=50`);
}

export function cleanupAndRetryRecoveryReview() {
  return apiPost<{ ok: true; summary: ActRecoveryCleanupRetrySummary }>(
    "/act-recovery/review/cleanup-retry",
    {},
  );
}

export async function searchRecoveryProfiles(query: string): Promise<RecoveryProfileSearchResult[]> {
  const search = query.trim();
  if (!search) return [];
  const params = new URLSearchParams({ q: search, pageSize: "20", showMembers: "yes" });
  const response = await apiGet<any>(`/organizations?${params.toString()}`);
  const organizations = Array.isArray(response) ? response : response?.organizations;
  if (!Array.isArray(organizations)) return [];
  return organizations.map((organization: any) => ({
    id: String(organization.id),
    name: String(organization.name ?? "Unnamed profile"),
    city: typeof organization.city === "string" ? organization.city : null,
    region: typeof organization.region === "string" ? organization.region : null,
  }));
}

export function assignRecoveryParent(input: {
  sourceRecordId: string;
  sourceVersionId: string;
  targetEntityType: "organization" | "contact" | "booking";
  targetEntityId: string;
}) {
  return apiPost<{ ok: true }>(
    `/act-recovery/review/${input.sourceRecordId}/assign`,
    {
      sourceVersionId: input.sourceVersionId,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
    },
  );
}

export function dropRecoveryItem(input: {
  sourceRecordId: string;
  sourceVersionId: string;
}) {
  return apiPost<{ ok: true }>(
    `/act-recovery/review/${input.sourceRecordId}/drop`,
    { sourceVersionId: input.sourceVersionId },
  );
}

export function retryRecoveryItem(input: {
  sourceRecordId: string;
  sourceVersionId: string;
}) {
  return apiPost<{ ok: true }>(
    `/act-recovery/review/${input.sourceRecordId}/retry`,
    { sourceVersionId: input.sourceVersionId },
  );
}
