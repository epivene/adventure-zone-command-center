import { describe, expect, it, vi } from "vitest";

import type { PrivateObjectStorage } from "@/lib/private-object-storage";
import { BusinessDocumentStorage } from "./business-document-storage";

function memoryObjects() {
  const bytes = new Map<string, Uint8Array>();
  const objects: PrivateObjectStorage = {
    put: vi.fn(async (key, value) => { bytes.set(key, value); }),
    get: vi.fn(async (key) => bytes.get(key) ?? new Uint8Array()),
    exists: vi.fn(async (key) => bytes.has(key)),
    getSignedReadUrl: vi.fn(async (key, ttl = 900) => `https://signed.example/${key}?ttl=${ttl}`),
    delete: vi.fn(async (key) => { bytes.delete(key); }),
  };
  return { bytes, objects };
}

describe("BusinessDocumentStorage", () => {
  it("stores equal bytes once under their checksum", async () => {
    const { objects } = memoryObjects();
    const storage = new BusinessDocumentStorage(objects);
    const input = new TextEncoder().encode("contract");

    const first = await storage.putIfAbsent(input, "application/pdf");
    const second = await storage.putIfAbsent(input, "application/pdf");

    expect(second).toEqual(first);
    expect(first.storageKey).toBe(`business-documents/${first.sha256Hex.slice(0, 2)}/${first.sha256Hex}`);
    expect(objects.put).toHaveBeenCalledOnce();
  });

  it("uses a short-lived signed URL", async () => {
    const { objects } = memoryObjects();
    const storage = new BusinessDocumentStorage(objects);
    await expect(storage.signedReadUrl("business-documents/aa/hash", 900)).resolves.toContain("ttl=900");
  });
});
