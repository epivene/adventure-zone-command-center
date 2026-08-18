import { describe, expect, it } from "vitest";
import { createLegManagerStorageOptionsFromEnv } from "./leg-manager-object-storage";

describe("leg manager object storage configuration", () => {
  it("uses receipt bucket and parses service account JSON credentials", () => {
    const options = createLegManagerStorageOptionsFromEnv({
      LEG_MANAGER_RECEIPT_BUCKET: "adventure-zone-receipts",
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: "adventure-zone",
        client_email: "receipts@example.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      }),
    });

    expect(options.bucketName).toBe("adventure-zone-receipts");
    expect(options.storageOptions).toMatchObject({
      projectId: "adventure-zone",
      credentials: {
        client_email: "receipts@example.iam.gserviceaccount.com",
      },
    });
  });

  it("throws a clear configuration error for invalid service account JSON", () => {
    expect(() => createLegManagerStorageOptionsFromEnv({
      LEG_MANAGER_RECEIPT_BUCKET: "adventure-zone-receipts",
      GOOGLE_SERVICE_ACCOUNT_JSON: "not-json",
    })).toThrow("GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON");
  });
});
