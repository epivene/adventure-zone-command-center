import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@localhost/test";
});
import { ensureChatGPTConnectionSchemaBeforeListen } from "./chatgpt-connection-required-startup";
it("keeps the schema lock on one client and always releases it on failure", async () => {
  const query = vi.fn(async () => ({ rows: [{ locked: true }] })),
    release = vi.fn();
  const pool = { connect: async () => ({ query, release }) };
  await expect(
    ensureChatGPTConnectionSchemaBeforeListen({
      pool,
      ensureSchema: async () => {
        throw Error("migration failed");
      },
    }),
  ).rejects.toThrow("migration failed");
  expect(query.mock.calls).toHaveLength(2);
  expect(release).toHaveBeenCalledOnce();
});
it("refuses migration when another instance holds its lock", async () => {
  const ensureSchema = vi.fn(),
    release = vi.fn();
  await expect(
    ensureChatGPTConnectionSchemaBeforeListen({
      pool: {
        connect: async () => ({
          query: async () => ({ rows: [{ locked: false }] }),
          release,
        }),
      },
      ensureSchema,
    }),
  ).rejects.toThrow("LOCK_BUSY");
  expect(ensureSchema).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
