import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { ensureWebsiteInquirySchemaBeforeListen } from "./website-inquiry-required-startup";

function fakeClient(locked = true) {
  return {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("pg_try_advisory_lock") ? [{ locked }] : [],
    })),
    release: vi.fn(),
  };
}

describe("ensureWebsiteInquirySchemaBeforeListen", () => {
  it("holds the feature lock while ensuring the schema", async () => {
    const client = fakeClient();
    const ensureSchema = vi.fn(async () => true);

    await expect(
      ensureWebsiteInquirySchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
        ensureSchema,
      }),
    ).resolves.toBe(true);

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock(hashtext('adventure-zone:website-inquiry-schema')) AS locked",
    );
    expect(ensureSchema).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:website-inquiry-schema'))",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("releases the client when the lock is busy", async () => {
    const client = fakeClient(false);
    const ensureSchema = vi.fn(async () => true);

    await expect(
      ensureWebsiteInquirySchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
        ensureSchema,
      }),
    ).rejects.toThrow("WEBSITE_INQUIRY_SCHEMA_LOCK_BUSY");
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("unlocks and releases when schema creation fails", async () => {
    const client = fakeClient();
    const error = new Error("ddl failed");

    await expect(
      ensureWebsiteInquirySchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
        ensureSchema: vi.fn(async () => {
          throw error;
        }),
      }),
    ).rejects.toBe(error);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:website-inquiry-schema'))",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });
});
