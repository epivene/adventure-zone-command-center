import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalBackfill } from "./google-historical-backfill";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  runNext: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-workspace-client", () => ({
  getGoogleHistoricalBackfill: mocks.getStatus,
  runNextGoogleHistoricalBatch: mocks.runNext,
  approveFirstGoogleHistoricalBatch: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-historical-backfill-client", () => ({
  retryGoogleHistoricalFailures: vi.fn(),
}));

vi.mock("@/components/google-workspace/google-validation-review", () => ({
  GoogleValidationReview: () => null,
}));

function view(processed: number) {
  return {
    syncEnabled: true,
    validationStatus: "approved" as const,
    state: {
      status: "ready" as const,
      nextPageToken: "older-page",
      firstBatchApproved: true,
      cumulative: {
        processed,
        attached: processed === 253 ? 203 : 386,
        ignored: processed === 253 ? 50 : 117,
        needsReview: 0,
        failed: 0,
        skipped: 0,
      },
    },
  };
}

describe("historical Gmail interrupted mobile response", () => {
  it("clears Failed to fetch when status proves the batch completed", async () => {
    mocks.getStatus
      .mockResolvedValueOnce(view(253))
      .mockResolvedValueOnce(view(503));
    mocks.runNext.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<GoogleHistoricalBackfill />);

    fireEvent.click(await screen.findByRole("button", { name: /continue next 250/i }));

    await waitFor(() => {
      expect(screen.getByText(/503/i)).toBeTruthy();
    });
    expect(screen.queryByText(/^Failed to fetch$/i)).toBeNull();
    expect(screen.getByText(/batch completed.*response was interrupted/i)).toBeTruthy();
  });

  it("keeps a real failure when status did not advance", async () => {
    mocks.getStatus
      .mockResolvedValueOnce(view(253))
      .mockResolvedValueOnce({
        ...view(253),
        state: { ...view(253).state, status: "error" as const },
      });
    mocks.runNext.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<GoogleHistoricalBackfill />);

    fireEvent.click(await screen.findByRole("button", { name: /continue next 250/i }));

    await screen.findByText(/^Failed to fetch$/i);
    expect(screen.queryByText(/batch completed.*response was interrupted/i)).toBeNull();
  });
});
