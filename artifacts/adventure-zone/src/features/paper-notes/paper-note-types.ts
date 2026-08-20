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
  entries: unknown[];
  importSummary: Record<string, number> | null;
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
