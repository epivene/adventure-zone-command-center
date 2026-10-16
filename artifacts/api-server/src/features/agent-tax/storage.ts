import { Storage } from "@google-cloud/storage";
import { GoogleCloudPrivateObjectStorage, type PrivateObjectStorage } from "@/lib/private-object-storage";

/** Reuse the established Render bucket; use private App Storage in Replit. */
export function createTaxStorage(): { storage: PrivateObjectStorage; available: boolean } {
  if (process.env.GOOGLE_CLOUD_STORAGE_BUCKET?.trim()) {
    return { storage: new GoogleCloudPrivateObjectStorage(), available: true };
  }
  const dir = process.env.PRIVATE_OBJECT_DIR?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const [bucket, ...prefix] = dir.split("/");
  const endpoint = "http://127.0.0.1:1106";
  const client = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${endpoint}/token`,
      type: "external_account",
      credential_source: { url: `${endpoint}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  const file = (key: string) => {
    if (!bucket || !prefix.length) throw new Error("Private tax receipt storage is not configured");
    return client.bucket(bucket).file([...prefix, key].join("/"));
  };
  return {
    available: Boolean(bucket && prefix.length),
    storage: {
      async put(key, bytes, contentType) {
        await file(key).save(Buffer.from(bytes), { resumable: false, contentType, metadata: { cacheControl: "private, no-store" } });
      },
      async get(key) { return new Uint8Array((await file(key).download())[0]); },
      async exists(key) { return (await file(key).exists())[0]; },
      async delete(key) { await file(key).delete({ ignoreNotFound: true }); },
      async getSignedReadUrl() { throw new Error("Tax files require authenticated downloads"); },
    },
  };
}
