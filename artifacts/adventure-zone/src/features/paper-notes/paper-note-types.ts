export type PaperNoteBatchStatus =
  | "draft" | "queued" | "extracting" | "review" | "importing" | "imported" | "failed" | "archived";
export type PaperNotePageStatus =
  | "uploading" | "uploaded" | "queued" | "extracting" | "extracted" | "needs_retry" | "reviewed_empty";

export type PaperNotePageView = {
  id: string;
  batchId: string;
  sortOrder: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  rotationDegrees: 0 | 90 | 180 | 270;
  status: PaperNotePageStatus;
  currentStage: "prepare" | "segment" | "extract_entries" | "complete" | null;
  pageHeading: string | null;
  pageActivityDate: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  extractedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperNoteEntrySummary = {
  id: string;
  batchId: string;
  pageId: string;
  sourceOrder: number;
  sourceRegion: { x: number; y: number; width: number; height: number } | null;
  reviewVersion: number;
  state: "needs_review" | "ready" | "approved" | "skipped" | "imported";
  destinationMode: "existing_profile" | "existing_profile_new_location" | "new_profile" | "skip" | null;
  selectedOrganizationId: string | null;
  selectedOrganizationLocationId: string | null;
  validationIssues: Array<{ fieldPath: string; message: string; severity: "warning" | "blocking" }>;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperNoteImportSummary = {
  profilesCreated: number;
  profilesUpdated: number;
  locationsCreated: number;
  contactsCreated: number;
  contactsLinked: number;
  phonesCreatedOrUpdated: number;
  historicalNotesCreated: number;
  followUpsCreated: number;
  entriesSkipped: number;
};

export type PaperNoteBatchPreflight = {
  ready: boolean;
  batchId: string;
  approvedCount: number;
  skippedCount: number;
  blocking: Array<{ entryId: string | null; code: string; message: string }>;
  preview: PaperNoteImportSummary;
};

export type PaperNoteBatchListItem = {
  id: string;
  name: string | null;
  status: PaperNoteBatchStatus;
  pageCount: number;
  extractedEntryCount: number;
  needsReviewCount: number;
  readyCount: number;
  approvedCount: number;
  skippedCount: number;
  failedPageCount: number;
  importedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperNoteBatchView = PaperNoteBatchListItem & {
  pages: PaperNotePageView[];
  entries: PaperNoteEntrySummary[];
  importSummary: PaperNoteImportSummary | null;
  failureCode: string | null;
  failureMessage: string | null;
  extractionStartedAt: string | null;
  reviewStartedAt: string | null;
  importStartedAt: string | null;
};

export type PaperNoteUploadProgress = {
  fileKey: string;
  filename: string;
  index: number;
  total: number;
  state: "pending" | "creating_page" | "uploading" | "uploaded" | "failed";
  pageId: string | null;
  error: string | null;
};

export type PaperNoteUploadResult = {
  fileKey: string;
  pageId: string | null;
  ok: boolean;
  error: string | null;
};
