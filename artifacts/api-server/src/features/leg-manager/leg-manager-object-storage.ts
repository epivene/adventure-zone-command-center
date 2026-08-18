import { Storage } from "@google-cloud/storage";

export interface LegManagerObjectStorage {
  put(key:string,bytes:Uint8Array,contentType:string):Promise<void>;
  getSignedReadUrl(key:string,expiresInSeconds?:number):Promise<string>;
  getSignedUrl?(key:string):Promise<string>;
  delete?(key:string):Promise<void>;
}

export class GoogleCloudLegManagerObjectStorage implements LegManagerObjectStorage {
  private readonly storage = new Storage();
  private readonly bucketName = process.env.LEG_MANAGER_RECEIPT_BUCKET ?? process.env.GOOGLE_CLOUD_STORAGE_BUCKET ?? "";

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
