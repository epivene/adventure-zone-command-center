import { describe, expect, it, vi } from "vitest";

import { GoogleValidationWithManualOverlayService } from "./google-validation-with-manual-overlay-service";

describe("GoogleValidationWithManualOverlayService", () => {
  it("forwards incremental validation options through the manual overlay", async () => {
    const result = {
      checkedLimit: 100,
      aiEnabled: false as const,
      historicalImportStarted: false as const,
      validationStatus: "ready_for_review" as const,
      counts: { discovered: 0, matched: 0, needsReview: 0, ignored: 0 },
      matched: [],
      needsReview: [],
      ignored: [],
    };
    const run = vi.fn(async () => result);
    const service = new GoogleValidationWithManualOverlayService(
      { run },
      { apply: async (value) => value },
    );

    await service.run(100, { skipProcessed: true });

    expect(run).toHaveBeenCalledWith(100, { skipProcessed: true });
  });
});
