import { describe, expect, it, vi } from "vitest";

import {
  PaperNoteSourceRestoreError,
  PaperNoteSourceRestoreService,
} from "./paper-note-source-restore-service";

const target = {
  batchId: "10000000-0000-4000-8000-000000000001",
  pageId: "20000000-0000-4000-8000-000000000001",
  sha256: "expected-hash",
  originalObjectKey: "paper-notes/batch/page/original",
};

describe("PaperNoteSourceRestoreService", () => {
  it("rejects replacement bytes whose hash differs from the original", async () => {
    const service = new PaperNoteSourceRestoreService(
      { findRestoreTarget: vi.fn(async () => target) },
      { putOriginal: vi.fn() },
      vi.fn(async () => ({ sha256: "different-hash", detectedMimeType: "image/jpeg" as const })),
    );

    await expect(service.restore({
      actorId: "owner",
      batchId: target.batchId,
      pageId: target.pageId,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
    })).rejects.toMatchObject({
      code: "SOURCE_HASH_MISMATCH",
    } satisfies Partial<PaperNoteSourceRestoreError>);
  });

  it("restores the exact original without changing database state", async () => {
    const putOriginal = vi.fn(async () => target.originalObjectKey);
    const repository = { findRestoreTarget: vi.fn(async () => target) };
    const service = new PaperNoteSourceRestoreService(
      repository,
      { putOriginal },
      vi.fn(async () => ({ sha256: "expected-hash", detectedMimeType: "image/jpeg" as const })),
    );

    await expect(service.restore({
      actorId: "owner",
      batchId: target.batchId,
      pageId: target.pageId,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
    })).resolves.toEqual({ ok: true });
    expect(putOriginal).toHaveBeenCalledWith(expect.objectContaining({
      batchId: target.batchId,
      pageId: target.pageId,
      mimeType: "image/jpeg",
    }));
  });
});
