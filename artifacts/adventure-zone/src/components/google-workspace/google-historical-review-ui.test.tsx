import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalBackfill } from "./google-historical-backfill";

const getBackfill = vi.fn(async () => ({
  syncEnabled: true,
  validationStatus: "approved" as const,
  state: {
    status: "awaiting_approval" as const,
    nextPageToken: "older-page",
    firstBatchApproved: false,
    cumulative: {
      processed: 253,
      attached: 201,
      ignored: 49,
      needsReview: 3,
      failed: 0,
      skipped: 0,
    },
  },
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => ({
  getGoogleHistoricalBackfill: () => getBackfill(),
  runNextGoogleHistoricalBatch: vi.fn(),
  approveFirstGoogleHistoricalBatch: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-historical-backfill-client", () => ({
  retryGoogleHistoricalFailures: vi.fn(),
}));

vi.mock("@/components/google-workspace/google-validation-review", () => ({
  GoogleValidationReview: ({ onPendingCountChange }: { onPendingCountChange?: (count: number) => void }) => (
    <div>
      <p>Historical review list</p>
      <button type="button" onClick={() => onPendingCountChange?.(2)}>Resolve one review</button>
    </div>
  ),
}));

describe("Historical Gmail review UI", () => {
  it("opens the shared review list from the historical card", async () => {
    render(<GoogleHistoricalBackfill />);

    const review = await screen.findByRole("button", { name: /review 3 emails/i });
    fireEvent.click(review);

    expect(await screen.findByText("Historical review list")).toBeTruthy();
  });

  it("refreshes historical counters when a review item is resolved", async () => {
    render(<GoogleHistoricalBackfill />);
    fireEvent.click(await screen.findByRole("button", { name: /review 3 emails/i }));

    getBackfill.mockResolvedValueOnce({
      syncEnabled: true,
      validationStatus: "approved",
      state: {
        status: "awaiting_approval",
        nextPageToken: "older-page",
        firstBatchApproved: false,
        cumulative: {
          processed: 253,
          attached: 202,
          ignored: 49,
          needsReview: 2,
          failed: 0,
          skipped: 0,
        },
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: /resolve one review/i }));

    await waitFor(() => {
      expect(screen.getByText("2", { selector: "p.mt-1" })).toBeTruthy();
    });
  });
});
