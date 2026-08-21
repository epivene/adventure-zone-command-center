import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaperNoteBatchCard } from "./paper-note-batch-card";
import type { PaperNoteBatchListItem } from "@/features/paper-notes/paper-note-types";

function batch(status: PaperNoteBatchListItem["status"]): PaperNoteBatchListItem {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Old call sheets",
    status,
    pageCount: 3,
    extractedEntryCount: 23,
    needsReviewCount: 15,
    readyCount: 6,
    approvedCount: 1,
    skippedCount: 1,
    failedPageCount: 0,
    importedAt: null,
    createdAt: "2026-08-20T18:00:00.000Z",
    updatedAt: "2026-08-20T18:00:00.000Z",
  };
}

describe("PaperNoteBatchCard delete action", () => {
  it("offers delete for a review batch and confirms the restart is CRM-safe", () => {
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<PaperNoteBatchCard batch={batch("review")} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /delete batch/i }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("does not delete anything from the CRM"));
    expect(onDelete).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001");
  });

  it("does not offer delete for imported batches", () => {
    render(<PaperNoteBatchCard batch={batch("imported")} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /delete batch/i })).toBeNull();
  });
});
