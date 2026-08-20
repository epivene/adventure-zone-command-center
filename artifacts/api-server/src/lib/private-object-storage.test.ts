import { describe, expect, it, vi } from "vitest";

import {
  createPrivateStorageOptionsFromEnv,
  GoogleCloudPrivateObjectStorage,
} from "./private-object-storage";

describe("private object storage", () => {
  it("parses the existing Google service-account configuration", () => {
    const options = createPrivateStorageOptionsFromEnv({
      GOOGLE_CLOUD_STORAGE_BUCKET: "adventure-zone-private",
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: "adventure-zone",
        client_email: "storage@example.iam.gserviceaccount.com",
        private_key: "private-key",
      }),
    }, ["GOOGLE_CLOUD_STORAGE_BUCKET"]);

    expect(options.bucketName).toBe("adventure-zone-private");
    expect(options.storageOptions).toMatchObject({
      projectId: "adventure-zone",
      credentials: { client_email: "storage@example.iam.gserviceaccount.com" },
    });
  });

  it("uses private no-store metadata and defaults signed reads to 900 seconds", async () => {
    const save = vi.fn(async () => undefined);
    const getSignedUrl = vi.fn(async (input: any) => [String(input.expires)]);
    const file = vi.fn(() => ({ save, getSignedUrl, exists: vi.fn(async () => [true]), download: vi.fn(), delete: vi.fn() }));
    const bucket = vi.fn(() => ({ file }));
    const storage = { bucket } as any;
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const subject = new GoogleCloudPrivateObjectStorage(
      { GOOGLE_CLOUD_STORAGE_BUCKET: "private" },
      ["GOOGLE_CLOUD_STORAGE_BUCKET"],
      storage,
    );

    await subject.put("paper-notes/x", new Uint8Array([1, 2]), "image/jpeg");
    const url = await subject.getSignedReadUrl("paper-notes/x");

    expect(save).toHaveBeenCalledWith(Buffer.from([1, 2]), {
      resumable: false,
      contentType: "image/jpeg",
      metadata: { cacheControl: "private, max-age=0, no-store" },
    });
    expect(getSignedUrl).toHaveBeenCalledWith({ action: "read", expires: 1_900_000 });
    expect(url).toBe("1900000");
    now.mockRestore();
  });

  it("checks existence without downloading object bytes", async () => {
    const exists = vi.fn(async () => [false]);
    const download = vi.fn(async () => [Buffer.from("secret")]);
    const storage = { bucket: () => ({ file: () => ({ exists, download }) }) } as any;
    const subject = new GoogleCloudPrivateObjectStorage(
      { GOOGLE_CLOUD_STORAGE_BUCKET: "private" },
      ["GOOGLE_CLOUD_STORAGE_BUCKET"],
      storage,
    );

    await expect(subject.exists("paper-notes/x")).resolves.toBe(false);
    expect(exists).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
  });
});
