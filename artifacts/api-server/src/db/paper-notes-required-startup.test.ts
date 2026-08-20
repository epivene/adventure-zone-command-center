import { describe, expect, it } from "vitest";

import { ensurePaperNotesSchemaBeforeListen } from "./paper-notes-required-startup";

function harness(options?: { ready?: boolean }) {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("pg_advisory_lock")) return { rows: [] };
      if (sql.includes("to_regclass") && sql.includes("paper_note_batches")) {
        return { rows: [{ ready: options?.ready ?? false }] };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  return {
    pool: { connect: async () => client },
    queries,
    released: () => released,
  };
}

describe("ensurePaperNotesSchemaBeforeListen", () => {
  it("blocks startup on a dedicated lock and applies the Paper Notes schema before releasing", async () => {
    const h = harness({ ready: false });
    const applied = await ensurePaperNotesSchemaBeforeListen({
      pool: h.pool,
      ensureSchema: async (client) => {
        await client.query("-- apply paper notes 066 --");
        return true;
      },
    });

    expect(applied).toBe(true);
    expect(h.queries[0]).toContain("pg_advisory_lock");
    expect(h.queries).toContain("-- apply paper notes 066 --");
    expect(h.queries.at(-1)).toContain("pg_advisory_unlock");
    expect(h.released()).toBe(true);
  });

  it("still releases the lock and client when schema application fails", async () => {
    const h = harness({ ready: false });
    await expect(ensurePaperNotesSchemaBeforeListen({
      pool: h.pool,
      ensureSchema: async () => { throw new Error("paper notes schema failed"); },
    })).rejects.toThrow("paper notes schema failed");

    expect(h.queries.at(-1)).toContain("pg_advisory_unlock");
    expect(h.released()).toBe(true);
  });
});
