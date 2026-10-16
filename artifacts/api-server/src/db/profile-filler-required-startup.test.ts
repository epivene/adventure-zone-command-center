import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureProfileFillerSchemaBeforeListen } from "./profile-filler-required-startup";

const readyRows = ["filler","filler_reason","filler_changed_at"].map((attname,i)=>({attname,attnum:i+1,type_oid:"mock",attnotnull:false,default_tree:null,constraint_tree:"mock",contype:"c",convalidated:true,connoinherit:false,enforced:true}));
function fakeClient(locked = true, ready = false) {
  return {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("pg_try_advisory_xact_lock") ? [{ locked }]
        : sql.includes("from pg_catalog.pg_class") ? (ready ? readyRows : []) : [],
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

    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenCalledWith("SET LOCAL lock_timeout = '5s'");
    expect(client.query).toHaveBeenCalledWith("SET LOCAL statement_timeout = '20s'");
    expect(client.query).toHaveBeenCalledWith(
      "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:profile-filler-schema')) AS locked",
    );
    expect(ensureSchema).toHaveBeenCalledWith(client, { inTransaction: true });
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("fails closed when another process owns the schema lock", async () => {
    const client = fakeClient(false);
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureProfileFillerSchemaBeforeListen({ pool, ensureSchema, lockWaitMs: 0 }),
    ).rejects.toThrow("PROFILE_FILLER_SCHEMA_LOCK_BUSY");

    expect(ensureSchema).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("skips locking and repair when the catalog already satisfies the contract", async () => {
    const client = fakeClient(false, true);
    const ensureSchema = vi.fn(async () => true);
    await expect(
      ensureProfileFillerSchemaBeforeListen({
        pool: { connect: async () => client }, ensureSchema,
      }),
    ).resolves.toBe(false);
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => sql.includes("advisory"))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("waits briefly for an overlapping deploy rather than failing immediately", async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      let attempts = 0;
      client.query.mockImplementation(async (sql) => ({
        rows: sql.includes("pg_try_advisory_xact_lock")
          ? [{ locked: ++attempts > 1 }]
          : sql.includes("from pg_catalog.pg_class") ? [] : [],
      }));
      const ensureSchema = vi.fn(async () => true);
      const result = expect(ensureProfileFillerSchemaBeforeListen({
        pool: { connect: async () => client }, ensureSchema, lockWaitMs: 1_000,
      })).resolves.toBe(true);
      await vi.advanceTimersByTimeAsync(250);
      await result;
      expect(attempts).toBe(2);
      expect(ensureSchema).toHaveBeenCalledOnce();
      expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys a read-timed-out connection without queuing rollback or unlock", async () => {
    const client = fakeClient(true);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from pg_catalog.pg_class")) throw new Error("Query read timeout");
      return { rows: [] };
    });
    await expect(
      ensureProfileFillerSchemaBeforeListen({ pool: { connect: async () => client } }),
    ).rejects.toThrow("Query read timeout");
    expect(client.query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("rolls back a failed repair and preserves the original error if rollback fails", async () => {
    const client = fakeClient(true);
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return query(sql);
    });
    const ensureSchema = vi.fn(async () => { throw new Error("repair failed"); });
    await expect(
      ensureProfileFillerSchemaBeforeListen({
        pool: { connect: async () => client }, ensureSchema,
      }),
    ).rejects.toThrow("repair failed");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("destroys a timed-out repair connection even after acquiring the schema lock", async () => {
    const client = fakeClient(true);
    await expect(ensureProfileFillerSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => { throw new Error("Query read timeout"); },
    })).rejects.toThrow("Query read timeout");
    expect(client.query.mock.calls.some(([sql]) => sql.includes("pg_try_advisory_xact_lock")))
      .toBe(true);
    expect(client.query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("fails closed and destroys the connection when commit fails", async () => {
    const client = fakeClient(true);
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql) => {
      if (sql === "COMMIT") throw new Error("commit failed");
      return query(sql);
    });
    const ensureSchema = vi.fn(async () => false);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureProfileFillerSchemaBeforeListen({ pool, ensureSchema }),
    ).rejects.toThrow("commit failed");

    expect(ensureSchema).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
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
