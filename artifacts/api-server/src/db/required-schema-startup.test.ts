import { describe, expect, it, vi } from "vitest";

import { runRequiredSchemaStartup } from "./required-schema-startup";

describe("runRequiredSchemaStartup", () => {
  it("creates required Google Workspace schema before lead Gmail foreign keys", async () => {
    const calls: string[] = [];
    let googleReady = false;
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
      ensureOfficeCoordinator: async () => false,
      ensureProfileTouch: async () => false,
      ensureDesignStudio: async () => false,
    });

    expect(calls).toEqual([
      "required paper notes schema",
      "required Google Workspace schema",
      "required lead intake schema",
      "required leg assignment schema",
      "required office coordinator schema",
      "required profile touch schema",
      "required Design Studio schema",
    ]);
  });
});
