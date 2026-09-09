import { bossGet, bossPatch, bossPost } from "@/lib/boss-auth-context";
import type { BossWorkRequestDetail, BossWorkRequestQueue, ConventionNotes } from "./boss-work-request-types";

export const getBossWorkQueue = () => bossGet<BossWorkRequestQueue>("/boss/work-requests");
export const getBossWorkRequest = (requestId: string) =>
  bossGet<BossWorkRequestDetail>(`/boss/work-requests/${requestId}`);

export const saveConventionDraft = (requestId: string, clientRevision: number, payload: Partial<ConventionNotes>) =>
  bossPatch<{ accepted: boolean; draft: { clientRevision: number } }>(
    `/boss/work-requests/${requestId}/convention-draft`,
    { clientRevision, payload },
  );

export const submitConventionNotes = (requestId: string, clientMutationId: string, payload: ConventionNotes) =>
  bossPost<{ submission: { id: string }; created: boolean }>(
    `/boss/work-requests/${requestId}/convention-submissions`,
    { clientMutationId, payload },
  );

export const updateConventionNotes = (requestId: string, submissionId: string, payload: ConventionNotes) =>
  bossPatch<{ submission: { id: string } }>(
    `/boss/work-requests/${requestId}/convention-submissions/${submissionId}`,
    payload,
  );

export const decideEmailTemplate = (
  requestId: string,
  decision: "approved" | "changes_requested",
  note?: string | null,
) => bossPost(`/boss/work-requests/${requestId}/template-decision`, { decision, note });
