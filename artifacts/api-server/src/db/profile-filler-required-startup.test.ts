import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureProfileFillerSchemaBeforeListen } from "./profile-filler-required-startup";

function fakeClient(locked = true) {
  return {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("pg_try_advisory_lock") ? [{ locked }] : [],
    })),
    release: vi.fn(),
  };
}

describe("ensureProfileFillerSchemaBeforeListen", () => {
  it("repairs the profile-filler schema while holding the startup lock", async () => {
    const client = fakeClient(true);
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureProfileFillerSchemaBeforeListen({ pool, ensureSchema }),
    ).resolves.toBe(true);

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock(hashtext('adventure-zone:profile-filler-schema')) AS locked",
    );
    expect(ensureSchema).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:profile-filler-schema'))",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("fails closed when another process owns the schema lock", async () => {
    const client = fakeClient(false);
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureProfileFillerSchemaBeforeListen({ pool, ensureSchema }),
    ).rejects.toThrow("PROFILE_FILLER_SCHEMA_LOCK_BUSY");

    expect(ensureSchema).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("fails closed when the advisory lock cannot be released", async () => {
    const client = fakeClient(true);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("pg_advisory_unlock")) throw new Error("unlock failed");
      return { rows: [] };
    });
    const ensureSchema = vi.fn(async () => false);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureProfileFillerSchemaBeforeListen({ pool, ensureSchema }),
    ).rejects.toThrow("unlock failed");

    expect(ensureSchema).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("runs before the API marks itself ready to serve traffic", () => {
    const startupSource = readFileSync(
      path.resolve(process.cwd(), "src/db/required-schema-startup.ts"),
      "utf8",
    );
    const indexSource = readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf8");

    expect(startupSource).toContain('"required profile filler schema"');
    expect(indexSource.indexOf("runRequiredSchemaStartup();")).toBeLessThan(
      indexSource.indexOf("markAppReady();"),
    );
  });
});