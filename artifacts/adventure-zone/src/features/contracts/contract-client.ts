import { apiFetch } from "@/lib/auth-token";
import type { ContractDraft, ContractStatus, ContractValues, ContractVersion } from "./contract-types";

async function json<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; currentRevision?: number };
    const error = new Error(body.error ?? `API ${response.status}`) as Error & { status: number; currentRevision?: number };
    error.status = response.status;
    error.currentRevision = body.currentRevision;
    throw error;
  }
  return response.json() as Promise<T>;
}

function body(value: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(value) };
}

export class ContractClient {
  getSettings() {
    return json<{ enabled: boolean; internalSignerName?: string; internalSignerEmail?: string | null; insuranceRecipientName?: string; insuranceRecipientEmail?: string }>("/contracts/settings");
  }
  updateSettings(input: { internalSignerName: string; internalSignerEmail: string; insuranceRecipientName: string; insuranceRecipientEmail: string }) {
    return json<{ settings: typeof input & { internalSignerOrder: 2 } }>("/contracts/settings", { method: "PATCH", body: JSON.stringify(input) });
  }
  startDraft(bookingId: string) {
    return json<{ draft: ContractDraft; reused: boolean }>(`/bookings/${bookingId}/contract-draft`, body({}));
  }
  getDraft(draftId: string) {
    return json<{ draft: ContractDraft }>(`/contract-drafts/${draftId}`);
  }
  saveDraft(draftId: string, expectedRevision: number, values: ContractValues) {
    return json<{ draft: ContractDraft }>(`/contract-drafts/${draftId}`, { method: "PATCH", body: JSON.stringify({ expectedRevision, values }) });
  }
  finalizeDraft(draftId: string) {
    return json<{ version: ContractVersion; reused: boolean }>(`/contract-drafts/${draftId}/finalize`, body({}));
  }
  listOrganization(organizationId: string) {
    return json<{ organizationId: string; contracts: ContractVersion[]; eligibleBookings: Array<{ id: string; name: string; openDraftId: string | null }> }>(`/organizations/${organizationId}/contracts`);
  }
  getVersion(versionId: string) {
    return json<{ version: ContractVersion }>(`/contracts/${versionId}`);
  }
  createReplacement(versionId: string) {
    return json<{ draft: ContractDraft }>(`/contracts/${versionId}/replacement`, body({}));
  }
  openFile(versionId: string, fileId: string) {
    return json<{ url: string }>(`/contracts/${versionId}/file/open`, body({ fileId }));
  }
  transition(versionId: string, status: "partially_signed" | "declined" | "cancelled" | "superseded") {
    return json<{ version: ContractVersion }>(`/contracts/${versionId}/status`, body({ status }));
  }
  confirmAdobeSent(versionId: string) {
    return json<{ state: { contractVersionId: string; contractStatus: ContractStatus }; reused: boolean }>(`/contracts/${versionId}/confirm-adobe-sent`, body({}));
  }
  async uploadSignedPdf(versionId: string, file: File) {
    return json<{ file: ContractVersion["files"] extends Array<infer T> ? T : never }>(`/contracts/${versionId}/signed-file`, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "X-File-Name": file.name },
      body: file,
    });
  }
  confirmSignedFile(versionId: string, fileId: string, confirmed: boolean) {
    return json<{ version: ContractVersion }>(`/contracts/${versionId}/signed-file/${fileId}/confirm`, body({ confirmed }));
  }
  retryCoiDraft(versionId: string) {
    return json<{ coiDraft: unknown }>(`/contracts/${versionId}/coi-draft/retry`, body({}));
  }
}

export const contractClient = new ContractClient();
