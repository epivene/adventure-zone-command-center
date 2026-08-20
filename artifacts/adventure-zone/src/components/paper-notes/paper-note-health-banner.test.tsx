import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaperNoteHealthBanner } from "./paper-note-health-banner";

describe("PaperNoteHealthBanner", () => {
  it("shows ready configuration and privacy-safe queue counts", () => {
    render(
      <PaperNoteHealthBanner
        health={{
          configuration: {
            storageAvailable: true,
            aiAvailable: true,
            maxBatchPages: 25,
            maxImageBytes: 12 * 1024 * 1024,
            acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
          },
          operations: {
            queuedPages: 2,
            extractingPages: 1,
            retryablePages: 3,
            batchesWaitingForReview: 4,
            importedBatchesLast24Hours: 5,
            failedImportsLast24Hours: 0,
            averagePageExtractionMs: 1500,
            malformedOutputRate: 0,
            providerUnavailableRate: 0,
          },
        }}
      />,
    );

    expect(screen.getByText("Private photo storage ready")).toBeInTheDocument();
    expect(screen.getByText("Handwriting AI ready")).toBeInTheDocument();
    expect(screen.getByText("2 queued · 1 reading · 3 need attention")).toBeInTheDocument();
  });

  it("warns when storage or AI is unavailable", () => {
    render(
      <PaperNoteHealthBanner
        health={{
          configuration: {
            storageAvailable: false,
            aiAvailable: false,
            maxBatchPages: 25,
            maxImageBytes: 12 * 1024 * 1024,
            acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
          },
          operations: {
            queuedPages: 0,
            extractingPages: 0,
            retryablePages: 0,
            batchesWaitingForReview: 0,
            importedBatchesLast24Hours: 0,
            failedImportsLast24Hours: 0,
            averagePageExtractionMs: null,
            malformedOutputRate: null,
            providerUnavailableRate: null,
          },
        }}
      />,
    );

    expect(screen.getByText("Private photo storage unavailable")).toBeInTheDocument();
    expect(screen.getByText("Handwriting AI unavailable")).toBeInTheDocument();
  });
});
