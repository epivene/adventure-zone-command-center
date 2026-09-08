import type { BusinessDocumentRecord } from "@/lib/business-documents-api";
import { bossFetch, bossGet } from "@/lib/boss-auth-context";

export type BossContractDocument = {
  id: string; documentId?: string | null; projectId: string; projectName: string; projectStatus: string;
  outputStatus: string; contractState: string; fileUrl: string | null; createdAt: string; completedAt: string | null;
};

export type BossCertificateDocument = {
  id: string; documentId: string | null; officeAccountId: string | null; officeAccountName?: string;
  name: string; assetId: string | null; assetName?: string | null; bookingId: string | null;
  bookingName: string | null; organizationId: string | null; organizationName: string | null;
  issueDate: string | null; expirationDate: string | null; reviewState: "reviewed" | "needs_review";
  expirationState: "current" | "expiring_soon" | "expired" | "incomplete"; fileAvailable: boolean;
  fileUrl: string | null; createdAt: string; updatedAt: string; legacyRecord?: boolean;
};

export type BossEmailDocument = {
  id: string; organizationId: string; organizationName: string; contactId: string; contactName: string;
  recipientEmail: string; subject: string; state: "draft" | "submitted" | "needs_changes" | "sending" | "sent";
  coordinatorNote: string | null; ownerReturnNote: string | null; submittedAt: string | null;
  sentAt: string | null; updatedAt: string;
};

export type BossDocumentsResponse = {
  contracts: BossContractDocument[];
  certificates: BossCertificateDocument[];
  emailDrafts: BossEmailDocument[];
  libraryDocuments?: Array<{ documentId: string; category: "coi" | "contract" | "operational_template"; name: string; fileAvailable: boolean }>;
  workspaceAvailable: boolean;
};

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const bossDocumentsApi = {
  list: () => bossGet<BossDocumentsResponse>("/boss/documents"),
};

export const bossBusinessDocumentsApi = {
  list(filters: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams();
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    if (filters.offset !== undefined) query.set("offset", String(filters.offset));
    const suffix = query.size ? `?${query.toString()}` : "";
    return bossGet<{ documents: BusinessDocumentRecord[] }>(`/boss/business-documents${suffix}`);
  },

  async listAll() {
    const documents: BusinessDocumentRecord[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      const page = await this.list({ limit, offset });
      documents.push(...page.documents);
      if (page.documents.length < limit) return { documents };
    }
  },

  async open(documentId: string) {
    const result = await bossFetch(`/boss/business-documents/${documentId}/open`, { method: "POST", body: "{}" }).then(responseJson<{ url: string }>);
    return result.url;
  },

  upload(file: File) {
    return bossFetch("/boss/business-documents/upload", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    }).then(responseJson<{ outcome: string; documentId?: string }>);
  },

  archive(documentId: string) {
    return bossFetch(`/boss/business-documents/${documentId}/archive`, { method: "POST", body: "{}" }).then(responseJson<{ ok: true }>);
  },

  delete(documentId: string) {
    return bossFetch(`/boss/business-documents/${documentId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    }).then(responseJson<{ ok: true }>);
  },
};
