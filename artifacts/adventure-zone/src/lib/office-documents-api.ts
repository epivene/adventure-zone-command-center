import type {
  BusinessDocumentCategory,
  BusinessDocumentProfileOption,
  BusinessDocumentRecord,
  BusinessDocumentReviewItem,
} from "@/lib/business-documents-api";
import { officeFetch, officeGet } from "@/lib/office-auth-context";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const officeBusinessDocumentsApi = {
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
    return officeGet<{ documents: BusinessDocumentRecord[] }>(`/office/business-documents${suffix}`);
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
    const result = await officeFetch(`/office/business-documents/${documentId}/open`, { method: "POST", body: "{}" })
      .then(responseJson<{ url: string }>);
    return result.url;
  },

  update(documentId: string, input: {
    displayName: string;
    category: BusinessDocumentCategory;
    notes: string | null;
  }) {
    return officeFetch(`/office/business-documents/${documentId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then(responseJson<{ document: BusinessDocumentRecord }>);
  },

  upload(file: File, metadata: { displayName: string; category: BusinessDocumentCategory }) {
    return officeFetch("/office/business-documents/upload", {
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

  deleteDocument(documentId: string) {
    return officeFetch(`/office/business-documents/${documentId}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    }).then(responseJson<{ ok: true }>);
  },

  reviewItems() {
    return officeGet<{ items: BusinessDocumentReviewItem[] }>("/office/business-documents/reviews");
  },

  reviewCount() {
    return officeGet<{ count: number }>("/office/business-documents/review-count");
  },

  async searchProfiles(query: string) {
    const response = await officeGet<{ records: BusinessDocumentProfileOption[] }>(
      `/office/profiles?q=${encodeURIComponent(query)}`,
    );
    return response.records;
  },

  reviewAction(reviewId: string, body: Record<string, unknown>) {
    return officeFetch(`/office/business-documents/reviews/${reviewId}/actions`, {
      method: "POST",
      body: JSON.stringify(body),
    }).then(responseJson<{ ok: true }>);
  },
};
