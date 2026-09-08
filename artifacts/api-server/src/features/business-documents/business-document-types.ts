import type {
  BusinessDocumentCategory,
  BusinessDocumentReviewState,
  BusinessDocumentSourceKind,
  BusinessDocumentTargetKind,
} from "@workspace/db";

export type StoredBusinessDocumentBlob = {
  sha256Hex: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
};

export type DocumentSourceIdentity = {
  sourceKind: BusinessDocumentSourceKind;
  sourceAccountKey: string;
  externalId: string;
  originalUrl: string | null;
  metadata: Record<string, unknown>;
};

export type DocumentLinkInput = {
  targetKind: BusinessDocumentTargetKind;
  targetId: string;
  confirmationMode: "manual" | "automatic" | "migrated";
  confidence: number | null;
  evidence: Array<Record<string, unknown>>;
};

export type BusinessDocumentIngestInput = {
  displayName: string;
  originalFilename: string;
  category: BusinessDocumentCategory;
  reviewState: BusinessDocumentReviewState;
  actor: string;
  blob: StoredBusinessDocumentBlob;
  source: DocumentSourceIdentity;
  links: DocumentLinkInput[];
  effectiveDate?: string | null;
  issueDate?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
};

export type DocumentIngestionOutcome = {
  outcome: "imported" | "deduplicated";
  documentId: string;
  versionId: string;
  blobId: string;
  reviewState: BusinessDocumentReviewState;
  linkedProfileIds: string[];
  linkedBookingIds: string[];
  linkedEventFamilyIds: string[];
};

export type BusinessDocumentView = {
  id: string;
  displayName: string;
  originalFilename: string;
  category: BusinessDocumentCategory;
  lifecycle: "active" | "archived" | "deleted";
  reviewState: BusinessDocumentReviewState;
  currentVersionId: string | null;
  effectiveDate: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  notes: string | null;
  fileAvailable: boolean;
  links: Array<{
    id: string;
    targetKind: BusinessDocumentTargetKind;
    targetId: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type BusinessDocumentReviewItemView = {
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

export type BusinessDocumentReviewAction =
  | { action: "approve" }
  | { action: "correct_and_approve"; corrections: Record<string, unknown> }
  | { action: "non_business" }
  | { action: "defer"; deferredUntil: string }
  | { action: "retry" };
