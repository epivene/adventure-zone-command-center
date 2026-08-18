import { Storage } from "@google-cloud/storage";

export interface LegManagerObjectStorage {
  put(key:string,bytes:Uint8Array,contentType:string):Promise<void>;
  getSignedReadUrl(key:string,expiresInSeconds?:number):Promise<string>;
  getSignedUrl?(key:string):Promise<string>;
  delete?(key:string):Promise<void>;
}

type StorageEnvironment = Partial<Record<
  "LEG_MANAGER_RECEIPT_BUCKET" | "GOOGLE_CLOUD_STORAGE_BUCKET" | "GOOGLE_SERVICE_ACCOUNT_JSON",
  string | undefined
>>;

type GoogleServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

export function createLegManagerStorageOptionsFromEnv(env: StorageEnvironment) {
  const bucketName = env.LEG_MANAGER_RECEIPT_BUCKET ?? env.GOOGLE_CLOUD_STORAGE_BUCKET ?? "";
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

export class GoogleCloudLegManagerObjectStorage implements LegManagerObjectStorage {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(env: StorageEnvironment = process.env) {
    const config = createLegManagerStorageOptionsFromEnv(env);
    this.bucketName = config.bucketName;
    this.storage = new Storage(config.storageOptions);
  }

  private bucket() {
    if (!this.bucketName) throw new Error("Leg manager object storage bucket is not configured");
    return this.storage.bucket(this.bucketName);
  }

  async put(key:string,bytes:Uint8Array,contentType:string) {
    await this.bucket().file(key).save(Buffer.from(bytes), { resumable:false, contentType, metadata:{ cacheControl:"private, max-age=0, no-store" } });
  }

  async getSignedReadUrl(key:string,expiresInSeconds=900) {
    const [url] = await this.bucket().file(key).getSignedUrl({ action:"read", expires:Date.now()+expiresInSeconds*1000 });
    return url;
  }

  async getSignedUrl(key:string) {
    return this.getSignedReadUrl(key, 15 * 60);
  }

  async delete(key:string) {
    if (!key.trim()) return;
    await this.bucket().file(key).delete({ ignoreNotFound: true });
  }
}
