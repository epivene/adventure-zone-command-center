import {
  GoogleCloudPrivateObjectStorage,
  type PrivateObjectStorage,
} from "@/lib/private-object-storage";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scopedKey(batchId: string, pageId: string, leaf: string) {
  if (!uuidPattern.test(batchId) || !uuidPattern.test(pageId)) {
    throw new Error("Paper note storage IDs must be UUIDs");
  }
  return `paper-notes/${batchId}/${pageId}/${leaf}`;
}

export function paperNoteOriginalObjectKey(batchId: string, pageId: string) {
  return scopedKey(batchId, pageId, "original");
}

export function paperNoteAnalysisObjectKey(batchId: string, pageId: string) {
  return scopedKey(batchId, pageId, "analysis");
}

export interface PaperNoteObjectStorage {
  putOriginal(input: {
    batchId: string;
    pageId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<string>;
  putAnalysis(input: {
    batchId: string;
    pageId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  signedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  deletePageObjects(keys: {
    originalObjectKey: string | null;
    analysisObjectKey: string | null;
  }): Promise<void>;
}

export class PaperNoteObjectStorageAdapter implements PaperNoteObjectStorage {
  constructor(private readonly storage: PrivateObjectStorage) {}

  async putOriginal(input: {
    batchId: string;
    pageId: string;
    bytes: Uint8Array;
    mimeType: string;
  }) {
    const key = paperNoteOriginalObjectKey(input.batchId, input.pageId);
    await this.storage.put(key, input.bytes, input.mimeType);
    return key;
  }

  async putAnalysis(input: {
    batchId: string;
    pageId: string;
    bytes: Uint8Array;
    mimeType: string;
  }) {
    const key = paperNoteAnalysisObjectKey(input.batchId, input.pageId);
    await this.storage.put(key, input.bytes, input.mimeType);
    return key;
  }

  get(key: string) {
    return this.storage.get(key);
  }

  exists(key: string) {
    return this.storage.exists(key);
  }

  signedReadUrl(key: string, expiresInSeconds = 900) {
    return this.storage.getSignedReadUrl(key, expiresInSeconds);
  }

  async deletePageObjects(keys: {
    originalObjectKey: string | null;
    analysisObjectKey: string | null;
  }) {
    if (keys.analysisObjectKey) await this.storage.delete(keys.analysisObjectKey);
    if (keys.originalObjectKey) await this.storage.delete(keys.originalObjectKey);
  }
}

export function createPaperNoteObjectStorage() {
  return new PaperNoteObjectStorageAdapter(
    new GoogleCloudPrivateObjectStorage(process.env, [
      "GOOGLE_CLOUD_STORAGE_BUCKET",
      "LEG_MANAGER_RECEIPT_BUCKET",
    ]),
  );
}
