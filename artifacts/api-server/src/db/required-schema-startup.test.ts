import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ||=
    "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { runRequiredSchemaStartup } from "./required-schema-startup";

describe("runRequiredSchemaStartup", () => {
  it("creates required schemas without reapplying the retired Kristy review cleanup", async () => {
    const calls: string[] = [];
    const timeouts = new Map<string, number | undefined>();
    const timeoutHooks = new Map<string, ((error: Error) => void) | undefined>();
    let googleReady = false;
    const run = vi.fn(async (
      name: string,
      step: () => Promise<unknown>,
      timeoutMs?: number,
      onTimeout?: (error: Error) => void,
    ) => {
      calls.push(name);
      timeouts.set(name, timeoutMs);
      timeoutHooks.set(name, onTimeout);
      return step();
    });
    await runRequiredSchemaStartup({
      run,
      ensurePaperNotes: async () => false,
      ensureInboundCalling: async () => false,
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
      ensureFollowUpDismissals: async () => true,
      ensureOrganizerFeedback: async () => false,
      ensureComputerCalling: async () => false,
      ensureOfficeCoordinator: async () => false,
      ensureBoss: async () => false,
      ensureWebsiteInquiries: async () => true,
      ensureProfileFiller: async () => false,
      ensureProfileTouch: async () => false,
      ensureDesignStudio: async () => false,
      ensureBusinessDocuments: async () => false,
    });

    expect(timeouts.get("required lead intake schema")).toBe(120_000);
    expect(timeoutHooks.get("required lead intake schema")).toEqual(expect.any(Function));
    expect(timeouts.get("required paper notes schema")).toBe(120_000);
    expect(timeoutHooks.get("required paper notes schema")).toBeUndefined();
    expect(calls).toEqual([
      "required paper notes schema",
      "required inbound calling schema",
      "required Google Workspace schema",
      "required lead intake schema",
      "required leg assignment schema",
      "required event review dismissal schema",
      "required follow-up dismissal persistence",
      "required organizer feedback schema",
      "required computer calling schema",
      "required office coordinator schema",
      "required Boss schema",
      "required website inquiry schema",
      "required profile filler schema",
      "required profile touch schema",
      "required Design Studio schema",
      "required business document schema",
    ]);
  });

  it("retries a required schema once when the database drops the connection", async () => {
    const ensurePaperNotes = vi.fn()
      .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
      .mockResolvedValue(false);
    const run = vi.fn(async (_name: string, step: () => Promise<unknown>) => step());
    const unchanged = async () => false;

    await runRequiredSchemaStartup({
      run,
      ensurePaperNotes,
      ensureInboundCalling: unchanged,
      ensureGoogleWorkspace: unchanged,
      ensureLeadIntake: unchanged,
      ensureLegAssignment: unchanged,
      ensureEventReviewDismissals: unchanged,
      ensureFollowUpDismissals: unchanged,
      ensureOrganizerFeedback: unchanged,
      ensureComputerCalling: unchanged,
      ensureOfficeCoordinator: unchanged,
      ensureBoss: unchanged,
      ensureWebsiteInquiries: unchanged,
      ensureProfileFiller: unchanged,
      ensureProfileTouch: unchanged,
      ensureDesignStudio: unchanged,
      ensureBusinessDocuments: unchanged,
    });

    expect(ensurePaperNotes).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.filter(([name]) => name === "required paper notes schema")).toHaveLength(2);
  });
});
