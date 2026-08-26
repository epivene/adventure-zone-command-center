import { describe, expect, it, vi } from "vitest";

import { ensureLeadIntakeSchemaBeforeListen } from "./lead-intake-required-startup";

describe("lead email startup readiness", () => {
  it("seeds and verifies the exact approved template under the startup lock before releasing it", async () => {
    const order: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        order.push(sql.includes("pg_advisory_unlock") ? "unlock" : sql.includes("pg_advisory_lock") ? "lock" : "query");
        return { rows: [] };
      }),
      release: vi.fn(() => order.push("release")),
    };
    const result = await ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => { order.push("schema"); return true; },
      ensureTemplateSeed: async () => { order.push("seed"); },
      isTemplateReady: async () => { order.push("ready"); return true; },
    });

    expect(result).toBe(true);
    expect(order).toEqual(["lock", "schema", "seed", "ready", "unlock", "release"]);
  });

  it("fails startup when the exact approved template is not ready", async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    await expect(ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => false,
      ensureTemplateSeed: async () => undefined,
      isTemplateReady: async () => false,
      getTemplateReadinessIssues: async () => ["sourceStorageReference"],
    })).rejects.toThrow("mismatched readiness fields: sourceStorageReference");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
