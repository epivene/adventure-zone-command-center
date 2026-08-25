import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalBackfill } from "./google-historical-backfill";

vi.mock("@/features/google-workspace/google-workspace-client", () => ({
  getGoogleHistoricalBackfill: vi.fn(async () => ({
    syncEnabled: true,
    validationStatus: "approved",
    state: {
      status: "not_started",
      nextPageToken: null,
      firstBatchApproved: false,
      cumulative: {
        processed: 0,
        attached: 0,
        ignored: 0,
        needsReview: 0,
        failed: 0,
        skipped: 0,
      },
    },
  })),
  runNextGoogleHistoricalBatch: vi.fn(async () => ({
    batchId: "batch-1",
    processed: 250,
    attached: 180,
    ignored: 60,
    needsReview: 8,
    failed: 2,
    skipped: 0,
    nextPageAvailable: true,
    state: "awaiting_approval",
  })),
  approveFirstGoogleHistoricalBatch: vi.fn(async () => ({
    ok: true,
    state: {
      status: "ready",
      nextPageToken: "older-page",
      firstBatchApproved: true,
      cumulative: {
        processed: 250,
        attached: 180,
        ignored: 60,
        needsReview: 8,
        failed: 2,
        skipped: 0,
      },
    },
  })),
  pauseGoogleHistoricalBackfill: vi.fn(async () => ({ ok: true, state: {} })),
}));

describe("GoogleHistoricalBackfill", () => {
  it("runs only the first 250 and then requires explicit approval", async () => {
    render(<GoogleHistoricalBackfill />);

    const run = await screen.findByRole("button", { name: /run first 250/i });
    fireEvent.click(run);

    await screen.findByText(/250 processed/i);
    expect(screen.getByRole("button", { name: /approve first batch/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue next 250/i })).toBeNull();
  });

  it("shows Continue next 250 only after explicit first-batch approval", async () => {
    render(<GoogleHistoricalBackfill />);
    fireEvent.click(await screen.findByRole("button", { name: /run first 250/i }));
    fireEvent.click(await screen.findByRole("button", { name: /approve first batch/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /continue next 250/i })).toBeTruthy();
    });
  });
});
