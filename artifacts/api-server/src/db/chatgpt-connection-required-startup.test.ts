import { afterEach, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { ensureChatGPTConnectionSchemaBeforeListen } from "./chatgpt-connection-required-startup";
afterEach(() => vi.useRealTimers());

it("skips all DDL and advisory locks when catalog readiness is satisfied", async () => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes(" AS ready") ? [{ ready: true }] : [],
  }));
  const release = vi.fn();
  await ensureChatGPTConnectionSchemaBeforeListen({
    pool: { connect: async () => ({ query, release }) },
  });
  expect(
    query.mock.calls
      .map(([sql]) => sql)
      .some((sql) => /CREATE|ALTER|pg_try_advisory/.test(sql)),
  ).toBe(false);
  expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  expect(release).toHaveBeenCalledWith(false);
});
it("rolls back and destroys a failed migration client", async () => {
  const query = vi.fn(async (_sql: string) => ({ rows: [{ locked: true }] })),
    release = vi.fn();
  await expect(
    ensureChatGPTConnectionSchemaBeforeListen({
      pool: { connect: async () => ({ query, release }) },
      ensureSchema: async () => {
        throw Error("migration failed");
      },
    }),
  ).rejects.toThrow("migration failed");
  expect(query.mock.calls.at(-1)).toEqual(["ROLLBACK"]);
  expect(release).toHaveBeenCalledWith(true);
});
it("uses server timeouts and a transaction-scoped lock on the same client", async () => {
  const calls: string[] = [],
    release = vi.fn();
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: [{ locked: true }] };
    },
    release,
  };
  const ensureSchema = vi.fn(async (received: unknown) => {
    expect(received).toBe(client);
  });
  await ensureChatGPTConnectionSchemaBeforeListen({
    pool: { connect: async () => client },
    ensureSchema,
  });
  expect(calls.slice(0, 3)).toEqual([
    "BEGIN",
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '20s'",
  ]);
  expect(calls[3]).toContain("pg_try_advisory_xact_lock");
  expect(calls.at(-1)).toBe("COMMIT");
  expect(release).toHaveBeenCalledWith(false);
});
it("waits briefly for another startup instead of immediately crashing", async () => {
  vi.useFakeTimers();
  let attempts = 0;
  const query = vi.fn(async (sql: string) => ({
    rows: [
      { locked: sql.includes("pg_try_advisory") ? ++attempts >= 2 : false },
    ],
  }));
  const ensureSchema = vi.fn(async () => {}),
    release = vi.fn();
  const pending = ensureChatGPTConnectionSchemaBeforeListen({
    pool: { connect: async () => ({ query, release }) },
    ensureSchema,
  });
  await vi.advanceTimersByTimeAsync(250);
  await pending;
  expect(attempts).toBe(2);
  expect(ensureSchema).toHaveBeenCalledOnce();
});
it("keeps startup closed when lock contention exceeds its budget", async () => {
  const query = vi.fn(async (_sql: string) => ({ rows: [{ locked: false }] })),
    ensureSchema = vi.fn(),
    release = vi.fn();
  await expect(
    ensureChatGPTConnectionSchemaBeforeListen({
      pool: { connect: async () => ({ query, release }) },
      ensureSchema,
      lockWaitMs: 0,
    }),
  ).rejects.toThrow("LOCK_BUSY");
  expect(ensureSchema).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledWith(true);
  expect(query.mock.calls.at(-1)).toEqual(["ROLLBACK"]);
});
it("destroys a timed-out client without queueing cleanup behind its running query", async () => {
  const query = vi.fn(async (_sql: string) => ({ rows: [{ locked: true }] })),
    release = vi.fn();
  await expect(
    ensureChatGPTConnectionSchemaBeforeListen({
      pool: { connect: async () => ({ query, release }) },
      ensureSchema: async () => {
        throw Error("Query read timeout");
      },
    }),
  ).rejects.toThrow("Query read timeout");
  expect(query.mock.calls.some((args) => args[0] === "ROLLBACK")).toBe(false);
  expect(release).toHaveBeenCalledWith(true);
});
