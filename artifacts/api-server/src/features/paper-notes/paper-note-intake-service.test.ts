import { describe, expect, it, vi } from "vitest";

import { PaperNoteIntakeService } from "./paper-note-intake-service";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";
const png = new Uint8Array([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0,0,0,0,0x49,0x48,0x44,0x52,
  0,0,0,100,0,0,0,100,
]);

function setup(overrides: Record<string, unknown> = {}) {
  const repository: any = {
    createBatch: vi.fn(),
    listBatches: vi.fn(),
    getBatch: vi.fn(),
    createUploadingPage: vi.fn(),
    getUploadTarget: vi.fn(async () => ({
      id: pageId,
      batchId,
      status: "uploading",
      originalObjectKey: `paper-notes/${batchId}/${pageId}/original`,
      analysisObjectKey: null,
      sha256: null,
    })),
    findDuplicateHash: vi.fn(async () => null),
    finalizeUploadedPage: vi.fn(async () => undefined),
    reorderDraftPages: vi.fn(),
    setDraftPageRotation: vi.fn(),
    deletePageRow: vi.fn(),
    listDraftPageObjects: vi.fn(),
    deleteDraftBatchRow: vi.fn(),
    queueBatch: vi.fn(),
    ...overrides,
  };
  const storage: any = {
    putOriginal: vi.fn(async () => `paper-notes/${batchId}/${pageId}/original`),
    putAnalysis: vi.fn(),
    get: vi.fn(),
    exists: vi.fn(),
    signedReadUrl: vi.fn(),
    deletePageObjects: vi.fn(async () => undefined),
  };
  return { repository, storage, service: new PaperNoteIntakeService(repository, storage) };
}

describe("PaperNoteIntakeService", () => {
  it("does not write storage or finalize when image validation fails", async () => {
    const { repository, storage, service } = setup();
    await expect(service.uploadPage({
      createdBy: "owner",
      batchId,
      pageId,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
      now: new Date("2026-08-20T18:00:00Z"),
    })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(storage.putOriginal).not.toHaveBeenCalled();
    expect(repository.finalizeUploadedPage).not.toHaveBeenCalled();
  });

  it("deletes the just-written source object when database finalization fails", async () => {
    const { storage, service } = setup({
      finalizeUploadedPage: vi.fn(async () => { throw new Error("db failed"); }),
    });
    await expect(service.uploadPage({
      createdBy: "owner",
      batchId,
      pageId,
      bytes: png,
      mimeType: "image/png",
      now: new Date("2026-08-20T18:00:00Z"),
    })).rejects.toThrow("db failed");
    expect(storage.deletePageObjects).toHaveBeenCalledWith({
      originalObjectKey: `paper-notes/${batchId}/${pageId}/original`,
      analysisObjectKey: null,
    });
  });

  it("deletes page objects before deleting the page row", async () => {
    const calls: string[] = [];
    const { repository, storage, service } = setup({
      deletePageRow: vi.fn(async () => { calls.push("row"); }),
    });
    storage.deletePageObjects.mockImplementation(async () => { calls.push("objects"); });

    await service.deletePage({
      createdBy: "owner",
      batchId,
      pageId,
      now: new Date("2026-08-20T18:00:00Z"),
    });

    expect(calls).toEqual(["objects", "row"]);
  });
});
