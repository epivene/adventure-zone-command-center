import { expect, it } from "vitest";
import { DeadlineRulesService } from "./service";

it("discards a connection whose rollback fails and preserves the original error", async () => {
  const original = new Error("Statement cancelled");
  let discarded = false;
  const db = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      async query(sql: string) {
        if (sql === "BEGIN") return { rows: [] };
        if (sql.startsWith("SET LOCAL")) return { rows: [] };
        if (sql === "ROLLBACK") throw new Error("Rollback timed out");
        throw original;
      },
      release(destroy?: boolean | Error) { discarded = Boolean(destroy); },
    }),
  };
  await expect(new DeadlineRulesService(db).evaluate()).rejects.toBe(original);
  expect(discarded).toBe(true);
});

it("destroys a timed-out client without queuing rollback behind the running query", async () => {
  let rollbackAttempted = false;
  let discarded = false;
  const db = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      async query(sql: string) {
        if (sql === "BEGIN" || sql.startsWith("SET LOCAL")) return { rows: [] };
        if (sql === "ROLLBACK") { rollbackAttempted = true; return { rows: [] }; }
        throw new Error("Query read timeout");
      },
      release(destroy?: boolean) { discarded = Boolean(destroy); },
    }),
  };
  await expect(new DeadlineRulesService(db).evaluate()).rejects.toThrow("Query read timeout");
  expect(rollbackAttempted).toBe(false);
  expect(discarded).toBe(true);
});
