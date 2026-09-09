import { apiFetch } from "@/lib/auth-token";
import type { BossWorkRequestDetail, BossWorkRequestQueue } from "./boss-work-request-types";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type OwnerWorkQueue = {
  needsDave: BossWorkRequestQueue["active"];
  submittedToMe: BossWorkRequestQueue["active"];
  changesRequested: BossWorkRequestQueue["active"];
  completed: BossWorkRequestQueue["active"];
};

export const getOwnerWorkQueue = () => apiFetch("/boss-work-requests").then(json<OwnerWorkQueue>);
export const getOwnerWorkRequest = (id: string) => apiFetch(`/boss-work-requests/${id}`).then(json<BossWorkRequestDetail>);
export const getBossAccounts = () => apiFetch("/boss-admin/accounts").then(json<{ accounts: { id: string; displayName: string; enabled: boolean }[] }>);
export const createOwnerWorkRequest = (input: unknown) => apiFetch("/boss-work-requests", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
}).then(json<BossWorkRequestDetail>);
export const returnWorkRequest = (id: string, note: string) => apiFetch(`/boss-work-requests/${id}/return-for-clarification`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
}).then(json);
export const cancelWorkRequest = (id: string, note?: string) => apiFetch(`/boss-work-requests/${id}/cancel`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
}).then(json);
export const previewConventionSubmission = (requestId: string, submissionId: string) =>
  apiFetch(`/boss-work-requests/${requestId}/submissions/${submissionId}/preview`).then(json<any>);
export const applyConventionSubmission = (requestId: string, submissionId: string, input: unknown) =>
  apiFetch(`/boss-work-requests/${requestId}/submissions/${submissionId}/apply`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }).then(json);
