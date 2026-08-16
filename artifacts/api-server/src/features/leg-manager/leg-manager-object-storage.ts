import { Storage } from "@google-cloud/storage";
export interface LegManagerObjectStorage { put(key:string,bytes:Uint8Array,contentType:string):Promise<void>; getSignedUrl?(key:string):Promise<string>; }
export class GoogleCloudLegManagerObjectStorage implements LegManagerObjectStorage {
  private readonly storage = new Storage();
  private readonly bucketName = process.env.LEG_MANAGER_RECEIPT_BUCKET ?? process.env.GOOGLE_CLOUD_STORAGE_BUCKET ?? "";
  async put(key:string,bytes:Uint8Array,contentType:string) {
    if (!this.bucketName) throw new Error("Receipt object storage bucket is not configured");
    await this.storage.bucket(this.bucketName).file(key).save(Buffer.from(bytes), { resumable:false, contentType, metadata:{ cacheControl:"private, max-age=0, no-store" } });
  }
  async getSignedUrl(key:string) {
    if (!this.bucketName) throw new Error("Receipt object storage bucket is not configured");
    const [url] = await this.storage.bucket(this.bucketName).file(key).getSignedUrl({ action:"read", expires:Date.now()+15*60*1000 });
    return url;
  }
}
