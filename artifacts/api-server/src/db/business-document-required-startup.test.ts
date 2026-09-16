import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { ensureBusinessDocumentSchemaBeforeListen } from "./business-document-required-startup";

describe("ensureBusinessDocumentSchemaBeforeListen", () => {
  it("applies the canonical schema with a bounded lock timeout", async () => {
    const client = {
      query: vi.fn(async (_sql: string) => ({ rows: [] })),
      release: vi.fn(),
    };

    await expect(
      ensureBusinessDocumentSchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
      }),
    ).resolves.toBeUndefined();

    expect(client.query).toHaveBeenNthCalledWith(1, "SET lock_timeout = '5s'");
    const schemaSql = String(client.query.mock.calls[1]?.[0]);
    expect(schemaSql).toContain(
      "CREATE TABLE IF NOT EXISTS business_documents",
    );
    expect(schemaSql).toContain(
      "DROP CONSTRAINT IF EXISTS business_documents_category_valid",
    );
    expect(schemaSql).toContain(
      "'contract','invoice','proposal'",
    );
    expect(client.query).toHaveBeenLastCalledWith("RESET lock_timeout");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("always resets the timeout and releases after a DDL failure", async () => {
    const client = {
      query: vi
        .fn<(sql: string) => Promise<{ rows: never[] }>>()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error("ddl failed"))
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };

    await expect(
      ensureBusinessDocumentSchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
      }),
    ).rejects.toThrow("ddl failed");
    expect(client.query).toHaveBeenLastCalledWith("RESET lock_timeout");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("ships checksum, source identity, and target-kind constraints", () => {
    const sql = readFileSync(
      new URL("../../../../lib/db/migrations/20260907_business_document_library.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("UNIQUE (sha256_hex)");
    expect(sql).toContain(
      "UNIQUE (source_kind, source_account_key, external_id)",
    );
    expect(sql).toContain(
      "CHECK (target_kind IN ('profile','booking','event_family'))",
    );
  });
});
