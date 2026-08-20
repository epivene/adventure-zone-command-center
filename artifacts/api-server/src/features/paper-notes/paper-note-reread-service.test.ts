import { describe, expect, it, vi } from "vitest";

import { PaperNoteRereadError, PaperNoteRereadService } from "./paper-note-reread-service";

const target = {
  batchId: "10000000-0000-4000-8000-000000000001",
  pageId: "20000000-0000-4000-8000-000000000001",
  batchStatus: "review",
  pageStatus: "extracted",
  analysisObjectKey: "paper-notes/batch/page/analysis.jpg",
  hasEntries: true,
  hasImportedEntries: false,
};

describe("PaperNoteRereadService", () => {
  it("requires explicit confirmation before discarding extracted review work", async () => {
    const repository = {
      getRereadTarget: vi.fn(async () => target),
      resetForReread: vi.fn(),
    };
    const storage = { deletePageObjects: vi.fn() };
    const service = new PaperNoteRereadService(repository, storage);

    await expect(service.reread({
      actorId: "owner",
      batchId: target.batchId,
      pageId: target.pageId,
      rotationDegrees: 90,
      confirmDiscardReview: false,
      now: new Date(),
    })).rejects.toMatchObject({
      code: "REREAD_CONFIRMATION_REQUIRED",
    } satisfies Partial<PaperNoteRereadError>);
    expect(storage.deletePageObjects).not.toHaveBeenCalled();
    expect(repository.resetForReread).not.toHaveBeenCalled();
  });

  it("deletes only the analysis object before resetting the page", async () => {
    const calls: string[] = [];
    const repository = {
      getRereadTarget: vi.fn(async () => target),
      resetForReread: vi.fn(async () => { calls.push("db"); }),
    };
    const storage = {
      deletePageObjects: vi.fn(async () => { calls.push("storage"); }),
    };
    const service = new PaperNoteRereadService(repository, storage);

    await service.reread({
      actorId: "owner",
      batchId: target.batchId,
      pageId: target.pageId,
      rotationDegrees: 90,
      confirmDiscardReview: true,
      now: new Date("2026-08-20T20:20:00Z"),
    });

    expect(calls).toEqual(["storage", "db"]);
    expect(storage.deletePageObjects).toHaveBeenCalledWith({
      originalObjectKey: null,
      analysisObjectKey: target.analysisObjectKey,
    });
    expect(repository.resetForReread).toHaveBeenCalledWith(expect.objectContaining({
      rotationDegrees: 90,
      actorId: "owner",
    }));
  });

  it("never rereads imported entries", async () => {
    const service = new PaperNoteRereadService({
      getRereadTarget: vi.fn(async () => ({ ...target, hasImportedEntries: true })),
      resetForReread: vi.fn(),
    }, { deletePageObjects: vi.fn() });

    await expect(service.reread({
      actorId: "owner",
      batchId: target.batchId,
      pageId: target.pageId,
      rotationDegrees: 180,
      confirmDiscardReview: true,
      now: new Date(),
    })).rejects.toMatchObject({ code: "PAGE_IMMUTABLE" });
  });
});
