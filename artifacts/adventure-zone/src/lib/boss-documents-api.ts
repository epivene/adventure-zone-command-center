import type {
  BusinessDocumentCategory,
  BusinessDocumentProfileOption,
  BusinessDocumentRecord,
  BusinessDocumentReviewItem,
} from "@/lib/business-documents-api";
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
  list(filters: {
    profileId?: string;
    category?: BusinessDocumentCategory;
    reviewState?: "accepted" | "needs_review" | "rejected";
    limit?: number;
    offset?: number;
  } = {}) {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    const suffix = query.size ? `?${query.toString()}` : "";
    return bossGet<{ documents: BusinessDocumentRecord[] }>(`/boss/business-documents${suffix}`);
  },

  async listAll(filters: {
    profileId?: string;
    category?: BusinessDocumentCategory;
    reviewState?: "accepted" | "needs_review" | "rejected";
  } = {}) {
    const documents: BusinessDocumentRecord[] = [];
    const limit = 100;
    for (let offset = 0; ; offset += limit) {
      const page = await this.list({ ...filters, limit, offset });
      documents.push(...page.documents);
      if (page.documents.length < limit) return { documents };
    }
  },

  async open(documentId: string) {
    const result = await bossFetch(`/boss/business-documents/${documentId}/open`, { method: "POST", body: "{}" }).then(responseJson<{ url: string }>);
    return result.url;
  },

  update(documentId: string, input: {
    displayName: string;
    category: BusinessDocumentCategory;
    notes: string | null;
  }) {
    return bossFetch(`/boss/business-documents/${documentId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then(responseJson<{ document: BusinessDocumentRecord }>);
  },

  upload(file: File, metadata: { displayName: string; category: BusinessDocumentCategory }) {
    return bossFetch("/boss/business-documents/upload", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-Document-Name": encodeURIComponent(metadata.displayName),
        "X-Document-Category": metadata.category,
      },
      body: file,
    }).then(responseJson<{ outcome: string; documentId?: string }>);
  },

  archive(documentId: string) {
    return bossFetch(`/boss/business-documents/${documentId}/archive`, { method: "POST", body: "{}" }).then(responseJson<{ ok: true }>);
  },

  deleteDocument(documentId: string) {
    return bossFetch(`/boss/business-documents/${documentId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    }).then(responseJson<{ ok: true }>);
  },

  delete(documentId: string) {
    return this.deleteDocument(documentId);
  },

  reviewItems() {
    return bossGet<{ items: BusinessDocumentReviewItem[] }>("/boss/business-documents/reviews");
  },

  reviewCount() {
    return bossGet<{ count: number }>("/boss/business-documents/review-count");
  },

  searchProfiles(query: string) {
    return bossGet<{ profiles: BusinessDocumentProfileOption[] }>(
      `/boss/business-documents/profiles?q=${encodeURIComponent(query)}`,
    ).then((response) => response.profiles);
  },

  reviewAction(reviewId: string, body: Record<string, unknown>) {
    return bossFetch(`/boss/business-documents/reviews/${reviewId}/actions`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(responseJson<{ ok: true }>);
  },
};
