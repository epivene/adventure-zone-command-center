import { describe, expect, it, vi } from "vitest";

import { runRequiredSchemaStartup } from "./required-schema-startup";

describe("runRequiredSchemaStartup", () => {
  it("creates required schemas without reapplying the retired Kristy review cleanup", async () => {
    const calls: string[] = [];
    let googleReady = false;
    const cleanupKristyReviews = vi.fn(async () => ({ status: "already_current" }));
    const run = vi.fn(async (name: string, step: () => Promise<unknown>) => {
      calls.push(name);
      return step();
    });

    await runRequiredSchemaStartup({
      run,
      ensurePaperNotes: async () => false,
      ensureGoogleWorkspace: async () => {
        googleReady = true;
        return true;
      },
      ensureLeadIntake: async () => {
        expect(googleReady).toBe(true);
        return true;
      },
      ensureLegAssignment: async () => false,
      ensureEventReviewDismissals: async () => false,
      cleanupKristyReviews,
      ensureOrganizerFeedback: async () => false,
      ensureOfficeCoordinator: async () => false,
      ensureProfileTouch: async () => false,
      ensureDesignStudio: async () => false,
    });

    expect(cleanupKristyReviews).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "required paper notes schema",
      "required Google Workspace schema",
      "required lead intake schema",
      "required leg assignment schema",
      "required event review dismissal schema",
      "required organizer feedback schema",
      "required office coordinator schema",
      "required profile touch schema",
      "required Design Studio schema",
    ]);
  });
});
