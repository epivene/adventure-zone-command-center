import { describe, expect, it, vi } from "vitest";

import { PaperNoteImportService } from "./paper-note-import-service";

function databaseHarness() {
  const execute = vi.fn(async () => ({
    rows: [{
      status: "review",
      importRequestKey: null,
      importSummary: null,
    }],
  }));
  const transaction = vi.fn();
  return { execute, transaction };
}

describe("PaperNoteImportService stale target protection", () => {
  it("does not start the CRM transaction when final preflight finds a changed target", async () => {
    const database = databaseHarness();
    const preflight = vi.fn(async () => ({
      ready: false,
      batchId: "10000000-0000-4000-8000-000000000001",
      approvedCount: 0,
      skippedCount: 0,
      blocking: [{
        entryId: "30000000-0000-4000-8000-000000000001",
        code: "TARGET_CHANGED",
        message: "The CRM information used for this paper entry changed since this paper entry was reviewed. Review it again before importing.",
      }],
      preview: {
        profilesCreated: 0,
        profilesUpdated: 0,
        locationsCreated: 0,
        contactsCreated: 0,
        contactsLinked: 0,
        phonesCreatedOrUpdated: 0,
        historicalNotesCreated: 0,
        followUpsCreated: 0,
        entriesSkipped: 0,
      },
    }));
    const service = new PaperNoteImportService(
      database as never,
      { preflight } as never,
      {} as never,
    );

    await expect(service.importBatch({
      actorId: "owner",
      batchId: "10000000-0000-4000-8000-000000000001",
      requestKey: "90000000-0000-4000-8000-000000000001",
      now: new Date("2026-08-20T21:30:00Z"),
    })).rejects.toMatchObject({ code: "BATCH_NOT_READY" });

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
