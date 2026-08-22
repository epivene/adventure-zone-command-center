import { describe, expect, it, vi } from "vitest";

import {
  MAX_SOURCE_DOCUMENT_BYTES,
  allowedSourceDocumentMimeTypes,
  sourceDocumentStorageKey,
  uploadSourceDocumentFile,
  type SourceDocumentFileMetadataStore,
  type SourceDocumentFileRecord,
} from "./source-document-file-service";
import type { SourceDocumentObjectStorage } from "./source-document-storage";

function record(overrides: Partial<SourceDocumentFileRecord> = {}): SourceDocumentFileRecord {
  return {
    id: "file-1",
    sourceDocumentId: "11111111-1111-4111-8111-111111111111",
    storageKey: "business-source-documents/old/key",
    mimeType: "application/pdf",
    originalSizeBytes: 3,
    sha256Hex: "oldsha",
    uploadedBy: "owner",
    uploadedAt: new Date("2026-08-22T12:00:00Z"),
    ...overrides,
  };
}

function fakeStorage() {
  const objects = new Map<string, Uint8Array>();
  const storage: SourceDocumentObjectStorage = {
    put: vi.fn(async (key, bytes) => { objects.set(key, bytes); }),
    getSignedReadUrl: vi.fn(async (key, expires = 300) => `https://signed.example/${key}?expires=${expires}`),
    delete: vi.fn(async (key) => { objects.delete(key); }),
  };
  return { storage, objects };
}

class MemoryMetadataStore implements SourceDocumentFileMetadataStore {
  current: SourceDocumentFileRecord | null = null;
  documentExists = vi.fn(async () => true);
  get = vi.fn(async () => this.current);
  replace = vi.fn(async (input: Omit<SourceDocumentFileRecord, "id">) => {
    this.current = { id: this.current?.id ?? "file-1", ...input };
    return this.current;
  });
  delete = vi.fn(async () => {
    const previous = this.current;
    this.current = null;
    return previous;
  });
}

const input = {
  documentId: "11111111-1111-4111-8111-111111111111",
  originalFilename: "contract.pdf",
  mimeType: "application/pdf",
  bytes: new Uint8Array([1, 2, 3]),
  actorId: "owner-1",
};

describe("source document file service", () => {
  it("accepts only the approved release-1 file types and 30 MB maximum", () => {
    expect(allowedSourceDocumentMimeTypes).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    expect(MAX_SOURCE_DOCUMENT_BYTES).toBe(30 * 1024 * 1024);
  });

  it("creates a stable SHA-256 object key and stores metadata", async () => {
    const store = new MemoryMetadataStore();
    const { storage } = fakeStorage();
    const result = await uploadSourceDocumentFile(store, storage, input);

    expect(result.sha256Hex).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    expect(result.storageKey).toBe(sourceDocumentStorageKey(input.documentId, result.sha256Hex));
    expect(storage.put).toHaveBeenCalledWith(result.storageKey, input.bytes, "application/pdf");
    expect(store.current).toMatchObject({
      sourceDocumentId: input.documentId,
      originalSizeBytes: 3,
      sha256Hex: result.sha256Hex,
      uploadedBy: "owner-1",
    });
  });

  it("is idempotent for identical bytes", async () => {
    const store = new MemoryMetadataStore();
    const { storage } = fakeStorage();
    const first = await uploadSourceDocumentFile(store, storage, input);
    const second = await uploadSourceDocumentFile(store, storage, input);
    expect(second).toEqual(first);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(store.replace).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported MIME and oversized input before storage", async () => {
    const store = new MemoryMetadataStore();
    const { storage } = fakeStorage();
    await expect(uploadSourceDocumentFile(store, storage, { ...input, mimeType: "text/plain" })).rejects.toThrow("Unsupported source document file type");
    await expect(uploadSourceDocumentFile(store, storage, { ...input, bytes: new Uint8Array(MAX_SOURCE_DOCUMENT_BYTES + 1) })).rejects.toThrow("Source document file is too large");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("leaves the old metadata authoritative when replacement DB update fails", async () => {
    const store = new MemoryMetadataStore();
    store.current = record();
    store.replace.mockRejectedValueOnce(new Error("db failed"));
    const { storage, objects } = fakeStorage();

    await expect(uploadSourceDocumentFile(store, storage, input)).rejects.toThrow("db failed");

    expect(store.current?.storageKey).toBe("business-source-documents/old/key");
    const expectedNewKey = sourceDocumentStorageKey(
      input.documentId,
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    expect(storage.put).toHaveBeenCalledWith(expectedNewKey, input.bytes, "application/pdf");
    expect(storage.delete).toHaveBeenCalledWith(expectedNewKey);
    expect(objects.has(expectedNewKey)).toBe(false);
    expect(storage.delete).not.toHaveBeenCalledWith("business-source-documents/old/key");
  });

  it("deletes the replaced old object only after metadata replacement succeeds", async () => {
    const store = new MemoryMetadataStore();
    store.current = record();
    const { storage } = fakeStorage();
    await uploadSourceDocumentFile(store, storage, input);
    expect(store.current?.storageKey).not.toBe("business-source-documents/old/key");
    expect(storage.delete).toHaveBeenCalledWith("business-source-documents/old/key");
  });
});
