import { apiDelete, apiGet, apiPost } from "@/lib/auth-token";

export type BusinessDocumentCategory =
  | "contract"
  | "proposal"
  | "coi"
  | "insurance_policy"
  | "w9_tax"
  | "permit"
  | "vendor_application"
  | "inspection"
  | "deposit_receipt"
  | "operational_template"
  | "marketing"
  | "other";

export type BusinessDocumentLink = {
  id: string;
  targetKind: "profile" | "booking" | "event_family";
  targetId: string;
};

export type BusinessDocumentRecord = {
  id: string;
  displayName: string;
  originalFilename: string;
  category: BusinessDocumentCategory;
  lifecycle: "active" | "archived" | "deleted";
  reviewState: "accepted" | "needs_review" | "rejected";
  currentVersionId: string | null;
  effectiveDate: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  fileAvailable: boolean;
  links: BusinessDocumentLink[];
};

export type BusinessDocumentReviewItem = {
  id: string;
  documentId: string;
  kind: "classification" | "relationship" | "metadata" | "source_failure";
  state: "pending" | "deferred";
  proposals: Record<string, unknown>;
  reasonCodes: string[];
  lastErrorCode: string | null;
  deferredUntil: string | null;
  displayName: string;
  originalFilename: string;
  category: BusinessDocumentCategory;
  createdAt: string;
};

export type BusinessDocumentProfileOption = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

type ListResponse = { documents: BusinessDocumentRecord[] };

function queryString(filters: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export const businessDocumentsApi = {
  list(filters: {
    profileId?: string;
    category?: BusinessDocumentCategory;
    reviewState?: "accepted" | "needs_review" | "rejected";
    limit?: number;
  } = {}) {
    return apiGet<ListResponse>(`/business-documents${queryString(filters)}`);
  },

  forProfile(profileId: string) {
    return this.list({ profileId, limit: 100 });
  },

  async open(documentId: string) {
    const result = await apiPost<{ url: string }>(`/business-documents/${documentId}/open`, {});
    return result.url;
  },

  unlink(documentId: string, linkId: string) {
    return apiDelete<{ ok: true }>(`/business-documents/${documentId}/links/${linkId}`);
  },

  reviewItems() {
    return apiGet<{ items: BusinessDocumentReviewItem[] }>("/business-documents/reviews");
  },

  reviewCount() {
    return apiGet<{ count: number }>("/business-documents/review-count");
  },

  async searchProfiles(query: string) {
    const response = await apiGet<{ organizations: { records: BusinessDocumentProfileOption[] } }>(
      `/organizations?q=${encodeURIComponent(query)}&pageSize=10&showMembers=yes&includeRetired=no`,
    );
    return response.organizations.records;
  },

  reviewAction(reviewId: string, body: Record<string, unknown>) {
    return apiPost<{ ok: true }>(`/business-documents/reviews/${reviewId}/actions`, body);
  },
};
