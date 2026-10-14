import { describe, it, expect, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { ensureGoogleWorkspaceSchemaBeforeListen } from "./google-workspace-required-startup";
describe("Google Workspace startup", () => {
  it("uses only catalog queries when installed, even if an old advisory lock is busy", async () => {
    const client = {
      query: vi.fn(async (sql: string) => ({
        rows: [sql.includes("advisory") ? { locked: false } : { ready: true }],
      })),
      release: vi.fn(),
    };
    await ensureGoogleWorkspaceSchemaBeforeListen({
      pool: { connect: async () => client },
    });
    expect(
      client.query.mock.calls.some(([s]) =>
        /advisory|ALTER TABLE|CREATE TABLE/.test(s),
      ),
    ).toBe(false);
    expect(client.release).toHaveBeenCalledWith(false);
  });
  it("runs repair hooks in order inside a transaction", async () => {
    const client = {
      query: vi.fn(async (_sql: string) => ({ rows: [{ locked: true }] })),
      release: vi.fn(),
    };
    const order: string[] = [];
    await ensureGoogleWorkspaceSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => {
        order.push("base");
        return true;
      },
      ensureOperationalCalendarUpgrade: async () => {
        order.push("calendar");
        return true;
      },
    });
    expect(order).toEqual(["base", "calendar"]);
    expect(client.query.mock.calls[0][0]).toBe("BEGIN");
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
  });
  it("fails closed on persistent contention", async () => {
    const client = {
      query: vi.fn(async (_sql: string) => ({
        rows: [{ locked: false, ready: false }],
      })),
      release: vi.fn(),
    };
    await expect(
      ensureGoogleWorkspaceSchemaBeforeListen({
        pool: { connect: async () => client },
        lockWaitMs: 0,
      }),
    ).rejects.toThrow("LOCK_BUSY");
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledWith(true);
  });
  it.each(["canceling statement due to lock timeout", "Query read timeout"])(
    "discards a failed repair connection: %s",
    async (message) => {
      const client = {
        query: vi.fn(async (_sql: string) => ({ rows: [{ locked: true }] })),
        release: vi.fn(),
      };
      await expect(
        ensureGoogleWorkspaceSchemaBeforeListen({
          pool: { connect: async () => client },
          ensureSchema: async () => {
            throw new Error(message);
          },
        }),
      ).rejects.toThrow(message);
      expect(client.release).toHaveBeenCalledWith(true);
      expect(client.query.mock.calls.some(([s]) => s === "ROLLBACK")).toBe(
        !message.includes("read timeout"),
      );
    },
  );
});
