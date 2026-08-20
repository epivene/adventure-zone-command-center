import { describe, expect, it, vi } from "vitest";

import { PaperNoteHealthService } from "./paper-note-health-service";

describe("PaperNoteHealthService", () => {
  it("returns configuration and count-only operational data", async () => {
    const repository = {
      operationalSummary: vi.fn(async () => ({
        queuedPages: 2,
        extractingPages: 1,
        retryablePages: 3,
        batchesWaitingForReview: 4,
        importedBatchesLast24Hours: 5,
        failedImportsLast24Hours: 1,
        averagePageExtractionMs: 1200,
        malformedOutputRate: 0.1,
        providerUnavailableRate: 0.2,
      })),
    };
    const service = new PaperNoteHealthService(repository, {
      GOOGLE_CLOUD_STORAGE_BUCKET: "private-bucket",
      OPENAI_API_KEY: "configured",
    });

    const result = await service.health();
    expect(result.configuration).toMatchObject({ storageAvailable: true, aiAvailable: true });
    expect(result.operations.queuedPages).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/filename|transcription|phone|email|objectKey/i);
  });
});
