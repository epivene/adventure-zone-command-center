export const paperNoteBatchStatusValues = [
  "draft",
  "queued",
  "extracting",
  "review",
  "importing",
  "imported",
  "failed",
  "archived",
] as const;

export const paperNotePageStatusValues = [
  "uploading",
  "uploaded",
  "queued",
  "extracting",
  "extracted",
  "needs_retry",
  "reviewed_empty",
] as const;

export const paperNotePageStageValues = [
  "prepare",
  "segment",
  "extract_entries",
  "complete",
] as const;

export const paperNoteEntryStateValues = [
  "needs_review",
  "ready",
  "approved",
  "skipped",
  "imported",
] as const;

export const paperNoteDestinationModeValues = [
  "existing_profile",
  "existing_profile_new_location",
  "new_profile",
  "skip",
] as const;

export const paperNotePhoneStatusValues = [
  "active",
  "questionable",
  "inactive",
] as const;

export type PaperNoteBatchStatus = (typeof paperNoteBatchStatusValues)[number];
export type PaperNotePageStatus = (typeof paperNotePageStatusValues)[number];
export type PaperNotePageStage = (typeof paperNotePageStageValues)[number];
export type PaperNoteEntryState = (typeof paperNoteEntryStateValues)[number];
export type PaperNoteDestinationMode = (typeof paperNoteDestinationModeValues)[number];
export type PaperNotePhoneStatus = (typeof paperNotePhoneStatusValues)[number];

export type PaperNoteRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function isNormalizedPaperNoteRegion(value: PaperNoteRegion): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.x >= 0
    && value.y >= 0
    && value.width > 0
    && value.height > 0
    && value.x + value.width <= 1
    && value.y + value.height <= 1;
}

export type PaperNoteConfigurationView = {
  storageAvailable: boolean;
  aiAvailable: boolean;
  maxBatchPages: number;
  maxImageBytes: number;
  acceptedMimeTypes: readonly ["image/jpeg", "image/png", "image/webp"];
};

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
  currentStage: PaperNotePageStage | null;
  pageHeading: string | null;
  pageActivityDate: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  extractedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperNoteEntryView = {
  id: string;
  batchId: string;
  pageId: string;
  sourceOrder: number;
  sourceRegion: PaperNoteRegion | null;
  reviewVersion: number;
  state: PaperNoteEntryState;
  destinationMode: PaperNoteDestinationMode | null;
  selectedOrganizationId: string | null;
  selectedOrganizationLocationId: string | null;
  validationIssues: Array<{
    fieldPath: string;
    message: string;
    severity: "warning" | "blocking";
  }>;
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
  entries: PaperNoteEntryView[];
  importSummary: PaperNoteImportSummary | null;
  failureCode: string | null;
  failureMessage: string | null;
  extractionStartedAt: string | null;
  reviewStartedAt: string | null;
  importStartedAt: string | null;
};

export type PaperNoteOperationalSummary = {
  queuedPages: number;
  extractingPages: number;
  retryablePages: number;
  batchesWaitingForReview: number;
  importedBatchesLast24Hours: number;
  failedImportsLast24Hours: number;
  averagePageExtractionMs: number | null;
  malformedOutputRate: number | null;
  providerUnavailableRate: number | null;
};
