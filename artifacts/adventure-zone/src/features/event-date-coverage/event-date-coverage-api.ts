import { apiGet, apiPost } from "@/lib/auth-token";

export type EventDateCoverageStatus = "booked" | "confirmed" | "expected" | "missing" | "stale" | "needs_review";
export type CoverageSummary = Record<EventDateCoverageStatus, number>;
export type CoverageRecord = {
  organizationId: string; name: string; city: string | null; region: string | null;
  status: EventDateCoverageStatus; lastKnownEventDate: string | null; lastResearchedAt: string | null;
  effectiveDate: { startsOn: string; endsOn: string | null; displayStatus: "booked" | "confirmed" | "expected"; sourceId: string } | null;
};
export type CoveragePage = { records: CoverageRecord[]; summary: CoverageSummary; total: number; page: number; pageSize: number; pageCount: number };
export type CoverageRun = { id: string; status: "queued" | "researching" | "complete" | "failed" | "cancelled"; items?: Array<{ id: string; status: string; errorDetail?: string | null }> };
export type CoverageFact = {
  id: string; startsOn: string; endsOn: string | null; status: "confirmed" | "expected" | "needs_review";
  active: boolean; rationale: string; sourceUrl: string | null; sourceTitle: string;
  sourceRecordType: string | null; sourceRecordId: string | null;
};

export const eventDateCoverageKeys = {
  all: ["event-date-coverage"] as const,
  profiles: (query: string) => ["event-date-coverage", "profiles", query] as const,
  run: (id: string) => ["event-date-coverage", "run", id] as const,
};

export const getCoverageSummary = () => apiGet<CoverageSummary>("/event-date-coverage/summary");
export const getCoverageProfiles = (input: { search: string; status: string; page?: number; pageSize?: number }) => {
  const query = new URLSearchParams({ search: input.search, status: input.status, page: String(input.page ?? 1), pageSize: String(input.pageSize ?? 25) });
  return apiGet<CoveragePage>(`/event-date-coverage/profiles?${query}`);
};
export const getCoverageProfile = (organizationId: string) => apiGet<{ organizationId: string; facts: CoverageFact[] }>(`/event-date-coverage/profiles/${encodeURIComponent(organizationId)}`);
export const startCoverageRun = (input: { organizationIds?: string[]; batchSize?: number }) => apiPost<CoverageRun>("/event-date-coverage/runs", input);
export const getCoverageRun = (runId: string) => apiGet<CoverageRun>(`/event-date-coverage/runs/${encodeURIComponent(runId)}`);
export const retryCoverageItem = (itemId: string) => apiPost(`/event-date-coverage/items/${encodeURIComponent(itemId)}/retry`, {});
export const reviewCoverageFact = (factId: string, decision: "approve_confirmed" | "approve_expected" | "dismiss") => apiPost(`/event-date-coverage/facts/${encodeURIComponent(factId)}/review`, { decision });
