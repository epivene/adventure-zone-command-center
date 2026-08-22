import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureOfficeCoordinatorSchemaBeforeListen } from "./office-coordinator-required-startup";

function fakeClient(locked = true) {
  return {
    query: vi.fn(async (sql: string) => ({ rows: sql.includes("pg_try_advisory_lock") ? [{ locked }] : [] })),
    release: vi.fn(),
  };
}

describe("ensureOfficeCoordinatorSchemaBeforeListen", () => {
  it("uses a non-blocking advisory lock before ensuring the schema", async () => {
    const client = fakeClient(true);
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureOfficeCoordinatorSchemaBeforeListen({ pool, ensureSchema }),
    ).resolves.toBe(true);

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock(hashtext('adventure-zone:office-coordinator-schema')) AS locked",
    );
    expect(ensureSchema).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:office-coordinator-schema'))",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("fails immediately instead of waiting forever when the schema lock is busy", async () => {
    const client = fakeClient(false);
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureOfficeCoordinatorSchemaBeforeListen({ pool, ensureSchema }),
    ).rejects.toThrow("OFFICE_COORDINATOR_SCHEMA_LOCK_BUSY");
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("ensures the Office Coordinator schema before the server accepts requests", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf8");
    const ensureAt = source.indexOf('"required office coordinator schema"');
    const listenAt = source.indexOf("const server = app.listen");

    expect(ensureAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(listenAt);
  });

  it("does not alter the hot organizations table during required startup and bounds DDL lock waits", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/db/office-coordinator-startup-migration.ts"), "utf8");
    expect(source).toContain("SET lock_timeout = '5s'");
    expect(source).toContain("RESET lock_timeout");
    expect(source).not.toContain("ALTER TABLE organizations");
  });
});
