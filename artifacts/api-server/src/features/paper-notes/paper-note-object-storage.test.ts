import { describe, expect, it, vi } from "vitest";

import {
  PaperNoteObjectStorageAdapter,
  paperNoteAnalysisObjectKey,
  paperNoteOriginalObjectKey,
} from "./paper-note-object-storage";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";

describe("paper note object storage", () => {
  it("scopes private keys only by batch and page UUID", () => {
    expect(paperNoteOriginalObjectKey(batchId, pageId)).toBe(
      `paper-notes/${batchId}/${pageId}/original`,
    );
    expect(paperNoteAnalysisObjectKey(batchId, pageId)).toBe(
      `paper-notes/${batchId}/${pageId}/analysis`,
    );
    expect(() => paperNoteOriginalObjectKey("not-a-uuid", pageId)).toThrow(
      "Paper note storage IDs must be UUIDs",
    );
  });

  it("stores originals and analysis copies at the scoped keys using their real content type", async () => {
    const put = vi.fn(async () => undefined);
    const storage = {
      put,
      get: vi.fn(),
      exists: vi.fn(),
      getSignedReadUrl: vi.fn(),
      delete: vi.fn(),
    };
    const subject = new PaperNoteObjectStorageAdapter(storage);

    await expect(subject.putOriginal({
      batchId,
      pageId,
      bytes: new Uint8Array([1]),
      mimeType: "image/jpeg",
    })).resolves.toBe(`paper-notes/${batchId}/${pageId}/original`);
    await expect(subject.putAnalysis({
      batchId,
      pageId,
      bytes: new Uint8Array([2]),
      mimeType: "image/jpeg",
    })).resolves.toBe(`paper-notes/${batchId}/${pageId}/analysis`);

    expect(put).toHaveBeenNthCalledWith(
      1,
      `paper-notes/${batchId}/${pageId}/original`,
      new Uint8Array([1]),
      "image/jpeg",
    );
    expect(put).toHaveBeenNthCalledWith(
      2,
      `paper-notes/${batchId}/${pageId}/analysis`,
      new Uint8Array([2]),
      "image/jpeg",
    );
  });

  it("deletes analysis before the original so failed cleanup keeps provenance", async () => {
    const calls: string[] = [];
    const storage = {
      put: vi.fn(),
      get: vi.fn(),
      exists: vi.fn(),
      getSignedReadUrl: vi.fn(),
      delete: vi.fn(async (key: string) => { calls.push(key); }),
    };
    const subject = new PaperNoteObjectStorageAdapter(storage);

    await subject.deletePageObjects({
      originalObjectKey: `paper-notes/${batchId}/${pageId}/original`,
      analysisObjectKey: `paper-notes/${batchId}/${pageId}/analysis`,
    });

    expect(calls).toEqual([
      `paper-notes/${batchId}/${pageId}/analysis`,
      `paper-notes/${batchId}/${pageId}/original`,
    ]);
  });
});
