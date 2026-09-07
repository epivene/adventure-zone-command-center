import { createHash } from "node:crypto";

import {
  GoogleCloudPrivateObjectStorage,
  type PrivateObjectStorage,
} from "@/lib/private-object-storage";
import type { StoredBusinessDocumentBlob } from "./business-document-types";

export class BusinessDocumentStorage {
  constructor(
    private readonly objects: PrivateObjectStorage = new GoogleCloudPrivateObjectStorage(),
  ) {}

  async putIfAbsent(
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<StoredBusinessDocumentBlob> {
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `business-documents/${sha256Hex.slice(0, 2)}/${sha256Hex}`;
    if (!(await this.objects.exists(storageKey))) {
      await this.objects.put(storageKey, bytes, mimeType);
    }
    return {
      sha256Hex,
      storageKey,
      sizeBytes: bytes.byteLength,
      mimeType,
    };
  }

  signedReadUrl(storageKey: string, ttlSeconds = 900) {
    return this.objects.getSignedReadUrl(storageKey, ttlSeconds);
  }

  get(storageKey: string) {
    return this.objects.get(storageKey);
  }
}
