import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalBackfill } from "./google-historical-backfill";

const getHistorical = vi.fn();
const runNext = vi.fn();

vi.mock("@/features/google-workspace/google-workspace-client", () => ({
  getGoogleHistoricalBackfill: (...args: unknown[]) => getHistorical(...args),
  runNextGoogleHistoricalBatch: (...args: unknown[]) => runNext(...args),
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

describe("Historical Gmail interrupted response handling", () => {
  it("treats Failed to fetch as completed when refreshed status advanced", async () => {
    getHistorical
      .mockResolvedValueOnce(view(253))
      .mockResolvedValueOnce(view(503));
    runNext.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<GoogleHistoricalBackfill />);

    fireEvent.click(await screen.findByRole("button", { name: /continue next 250/i }));

    await screen.findByText(/batch completed; connection response was interrupted/i);
    expect(screen.queryByText(/^Failed to fetch$/i)).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("503")).toBeTruthy();
    });
  });
});
