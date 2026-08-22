import {
  GoogleCloudPrivateObjectStorage,
  type PrivateStorageEnvironment,
} from "@/lib/private-object-storage";

export interface SourceDocumentObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export class GoogleCloudSourceDocumentObjectStorage
implements SourceDocumentObjectStorage {
  private readonly storage: GoogleCloudPrivateObjectStorage;

  constructor(env: PrivateStorageEnvironment = process.env) {
    this.storage = new GoogleCloudPrivateObjectStorage(env, [
      "GOOGLE_CLOUD_STORAGE_BUCKET",
    ]);
  }

  put(key: string, bytes: Uint8Array, contentType: string) {
    return this.storage.put(key, bytes, contentType);
  }

  getSignedReadUrl(key: string, expiresInSeconds = 300) {
    return this.storage.getSignedReadUrl(key, expiresInSeconds);
  }

  delete(key: string) {
    return this.storage.delete(key);
  }
}
