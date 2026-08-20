import {
  createPrivateStorageOptionsFromEnv,
  GoogleCloudPrivateObjectStorage,
  type PrivateObjectStorage,
  type PrivateStorageEnvironment,
} from "@/lib/private-object-storage";

export interface LegManagerObjectStorage {
  put(key:string,bytes:Uint8Array,contentType:string):Promise<void>;
  getSignedReadUrl(key:string,expiresInSeconds?:number):Promise<string>;
  getSignedUrl?(key:string):Promise<string>;
  delete?(key:string):Promise<void>;
}

type StorageEnvironment = PrivateStorageEnvironment;

export function createLegManagerStorageOptionsFromEnv(env: StorageEnvironment) {
  return createPrivateStorageOptionsFromEnv(env, [
    "LEG_MANAGER_RECEIPT_BUCKET",
    "GOOGLE_CLOUD_STORAGE_BUCKET",
  ]);
}

export class GoogleCloudLegManagerObjectStorage implements LegManagerObjectStorage {
  private readonly storage: PrivateObjectStorage;

  constructor(env: StorageEnvironment = process.env) {
    this.storage = new GoogleCloudPrivateObjectStorage(env, [
      "LEG_MANAGER_RECEIPT_BUCKET",
      "GOOGLE_CLOUD_STORAGE_BUCKET",
    ]);
  }

  put(key:string,bytes:Uint8Array,contentType:string) {
    return this.storage.put(key, bytes, contentType);
  }

  getSignedReadUrl(key:string,expiresInSeconds=900) {
    return this.storage.getSignedReadUrl(key, expiresInSeconds);
  }

  getSignedUrl(key:string) {
    return this.getSignedReadUrl(key, 15 * 60);
  }

  delete(key:string) {
    return this.storage.delete(key);
  }
}
