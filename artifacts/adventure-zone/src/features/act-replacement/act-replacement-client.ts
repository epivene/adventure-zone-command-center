import { apiFetch } from "@/lib/auth-token";

export const ACT_PAGE_SIZES = [25, 50, 100, 200] as const;
export type ActPageSize = (typeof ACT_PAGE_SIZES)[number];
export type ActReplacementPhase = "extracting" | "extract_complete" | "organizing" | "ready_to_apply" | "applying" | "complete" | "complete_with_issues" | "failed" | "superseded";
export type ActSafeErrorCode = "not_configured" | "authentication_failed" | "permission_denied" | "query_rejected" | "not_found" | "endpoint_unsupported" | "rate_limited" | "timeout" | "unavailable" | "invalid_response" | "pagination_stalled";
export type ActReplacementStatus = {
  runId: string; phase: ActReplacementPhase; previewOnly: boolean; pageSize: ActPageSize;
  streams: Array<{
    streamType: string; state: string; completedCheckpoints: number; totalCheckpoints: number;
    queryMode: string; lastSucceededAt: string | null; error: { code: ActSafeErrorCode; retryable: boolean; retryAfter: string | null } | null;
    responseRows: number; observedIdentities: number; archivedIdentities: number; completeIdentities: number; partialIdentities: number; failedIdentities: number; snapshotVersionsInserted: number;
  }>;
  allStreams: { responseRows: number; observedIdentities: number; archivedIdentities: number; completeIdentities: number; partialIdentities: number; failedIdentities: number; snapshotVersionsInserted: number; unsupportedCapabilities: number };
  canResume: boolean; canStartOver: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.code === "string" ? payload.code : `API ${response.status}`);
  return payload as T;
}
export const getLatestRun = () => request<{ run: ActReplacementStatus | null }>("/migration/act-replacement/runs/latest");
export const getRun = (runId: string) => request<{ run: ActReplacementStatus }>(`/migration/act-replacement/runs/${encodeURIComponent(runId)}`);
export const startRun = (pageSize: ActPageSize, requestKey = crypto.randomUUID()) => request<{ created: boolean; run: ActReplacementStatus }>("/migration/act-replacement/runs", { method: "POST", body: JSON.stringify({ requestKey, pageSize }) });
export const resumeRun = (runId: string) => request<{ run: ActReplacementStatus }>(`/migration/act-replacement/runs/${encodeURIComponent(runId)}/resume`, { method: "POST", body: "{}" });
export const supersedeRun = (runId: string) => request<{ run: ActReplacementStatus }>(`/migration/act-replacement/runs/${encodeURIComponent(runId)}/supersede`, { method: "POST", body: JSON.stringify({ confirm: "START OVER" }) });

