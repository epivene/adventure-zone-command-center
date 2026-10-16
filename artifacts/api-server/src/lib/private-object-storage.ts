import { Storage } from "@google-cloud/storage";
import type { Readable } from "node:stream";

export type PrivateStorageBucketKey =
  | "LEG_MANAGER_RECEIPT_BUCKET"
  | "GOOGLE_CLOUD_STORAGE_BUCKET";

export type PrivateStorageEnvironment = Partial<Record<
  PrivateStorageBucketKey | "GOOGLE_SERVICE_ACCOUNT_JSON",
  string | undefined
>>;

type GoogleServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

type StorageLike = Pick<Storage, "bucket">;

export interface PrivateObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Optional for existing consumers; required for bounded-memory accountant exports. */
  openReadStream?(key: string): Readable;
  exists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export function createPrivateStorageOptionsFromEnv(
  env: PrivateStorageEnvironment,
  bucketKeys: readonly PrivateStorageBucketKey[],
) {
  const bucketName = bucketKeys
    .map((key) => env[key]?.trim() ?? "")
    .find(Boolean) ?? "";
  const rawCredentials = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawCredentials) {
    return { bucketName, storageOptions: undefined };
  }

  let credentials: GoogleServiceAccount;
  try {
    credentials = JSON.parse(rawCredentials) as GoogleServiceAccount;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }

  return {
    bucketName,
    storageOptions: {
      ...(credentials.project_id ? { projectId: credentials.project_id } : {}),
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
    },
  };
}

export class GoogleCloudPrivateObjectStorage implements PrivateObjectStorage {
  private readonly storage: StorageLike;
  private readonly bucketName: string;

  constructor(
    env: PrivateStorageEnvironment = process.env,
    bucketKeys: readonly PrivateStorageBucketKey[] = ["GOOGLE_CLOUD_STORAGE_BUCKET"],
    storage?: StorageLike,
  ) {
    const config = createPrivateStorageOptionsFromEnv(env, bucketKeys);
    this.bucketName = config.bucketName;
    this.storage = storage ?? new Storage(config.storageOptions);
  }

  private bucket() {
    if (!this.bucketName) throw new Error("Private object storage bucket is not configured");
    return this.storage.bucket(this.bucketName);
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.bucket().file(key).save(Buffer.from(bytes), {
      resumable: false,
      contentType,
      metadata: { cacheControl: "private, max-age=0, no-store" },
    });
  }

  async get(key: string) {
    const [bytes] = await this.bucket().file(key).download();
    return new Uint8Array(bytes);
  }

  openReadStream(key: string) {
    return this.bucket().file(key).createReadStream();
  }

  async exists(key: string) {
    const [exists] = await this.bucket().file(key).exists();
    return exists;
  }

  async getSignedReadUrl(key: string, expiresInSeconds = 900) {
    const [url] = await this.bucket().file(key).getSignedUrl({
      action: "read",
      expires: Date.now() + expiresInSeconds * 1000,
    });
    return url;
  }

  async delete(key: string) {
    if (!key.trim()) return;
    await this.bucket().file(key).delete({ ignoreNotFound: true });
  }
}
