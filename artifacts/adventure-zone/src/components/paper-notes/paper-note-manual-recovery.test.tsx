import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PaperNoteBatchReviewPage from "@/pages/PaperNoteBatchReviewPage";
import type { PaperNoteBatchView, PaperNotePageStatus, PaperNoteBatchStatus } from "@/features/paper-notes/paper-note-types";

afterEach(cleanup);

function renderBatch(pageStatus: PaperNotePageStatus, batchStatus: PaperNoteBatchStatus = "review") {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const now = "2026-10-06T15:00:00Z";
  const batch: PaperNoteBatchView = {
    id: "batch", name: "Multiple events on one photo", status: batchStatus, pageCount: 1,
    extractedEntryCount: 0, needsReviewCount: 0, readyCount: 0, approvedCount: 0, skippedCount: 0,
    failedPageCount: pageStatus === "needs_retry" ? 1 : 0, importedAt: null, createdAt: now, updatedAt: now,
    entries: [], importSummary: null, failureCode: null, failureMessage: null,
    extractionStartedAt: null, reviewStartedAt: now, importStartedAt: null,
    pages: [{
      id: "page", batchId: "batch", sortOrder: 0, originalFilename: "notes.jpg", mimeType: "image/jpeg",
      sizeBytes: 100, width: null, height: null, rotationDegrees: 0, status: pageStatus,
      currentStage: null, pageHeading: null, pageActivityDate: null, attemptCount: 0,
      lastErrorCode: null, lastErrorMessage: null, extractedAt: null, createdAt: now, updatedAt: now,
    }],
  };
  client.setQueryData(["paper-notes", "batch", "batch"], batch);
  render(<QueryClientProvider client={client}><PaperNoteBatchReviewPage batchId="batch" /></QueryClientProvider>);
}

describe("Manual paper entry recovery", () => {
  it.each(["needs_retry", "extracted"] as const)("offers manual entry on a %s photo", (status) => {
    renderBatch(status);
    expect(screen.getByRole("textbox", { name: "Add an entry manually" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save manual entry" })).toBeDisabled();
  });
  it.each(["queued", "extracting", "reviewed_empty"] as const)("does not offer manual entry on a %s photo", (status) => {
    renderBatch(status);
    expect(screen.queryByRole("textbox", { name: "Add an entry manually" })).not.toBeInTheDocument();
  });
  it.each(["importing", "imported", "archived"] as const)("keeps %s batches read-only", (status) => {
    renderBatch("extracted", status);
    expect(screen.queryByRole("textbox", { name: "Add an entry manually" })).not.toBeInTheDocument();
  });
});
