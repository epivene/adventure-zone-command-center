import { describe, expect, it, vi } from "vitest";

import { runRequiredSchemaStartup } from "./required-schema-startup";

describe("runRequiredSchemaStartup", () => {
  it("creates owner auth first and Google Workspace before lead Gmail foreign keys", async () => {
    const calls: string[] = [];
    let ownerReady = false;
    let googleReady = false;
    const run = vi.fn(async (name: string, step: () => Promise<unknown>) => {
      calls.push(name);
      return step();
    });

    await runRequiredSchemaStartup({
      run,
      ensureOwnerAccount: async () => {
        ownerReady = true;
        return true;
      },
      ensurePaperNotes: async () => {
        expect(ownerReady).toBe(true);
        return false;
      },
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
      "required owner account schema",
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
