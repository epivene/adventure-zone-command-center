import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GoogleHistoricalBackfill } from "./google-historical-backfill";

vi.mock("@/features/google-workspace/google-workspace-client", () => ({
  getGoogleHistoricalBackfill: vi.fn(async () => ({
    syncEnabled: true,
    validationStatus: "approved",
    state: {
      status: "error",
      nextPageToken: null,
      firstBatchApproved: false,
      cumulative: {
        processed: 20,
        attached: 20,
        ignored: 0,
        needsReview: 0,
        failed: 0,
        skipped: 0,
      },
    },
  })),
  runNextGoogleHistoricalBatch: vi.fn(),
  approveFirstGoogleHistoricalBatch: vi.fn(),
}));

vi.mock("@/features/google-workspace/google-historical-backfill-client", () => ({
  retryGoogleHistoricalFailures: vi.fn(),
}));

vi.mock("@/components/google-workspace/google-validation-review", () => ({
  GoogleValidationReview: () => null,
}));

describe("Historical Gmail partial first-batch recovery", () => {
  it("offers a first-batch retry after an interrupted run saved some messages", async () => {
    render(<GoogleHistoricalBackfill />);

    expect(await screen.findByRole("button", { name: /retry first 100/i })).toBeTruthy();
  });
});
