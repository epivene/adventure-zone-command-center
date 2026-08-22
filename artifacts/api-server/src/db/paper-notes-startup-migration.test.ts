import { describe, expect, it, vi } from "vitest";

import { ensurePaperNotesSchema } from "./paper-notes-startup-migration";

function client(ready: boolean) {
  const queries: string[] = [];
  return {
    queries,
    client: {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("paper_note_batches") && sql.includes("paper_note_pages") && sql.includes("AS ready")) {
          return { rows: [{ ready }] };
        }
        return { rows: [] };
      },
    },
  };
}

describe("ensurePaperNotesSchema", () => {
  it("skips migration 066 when the Paper Notes schema is already ready", async () => {
    const h = client(true);
    const loadSql = vi.fn(async () => "create table should_not_run(id int);");

    await expect(ensurePaperNotesSchema(h.client, { loadSql })).resolves.toBe(false);
    expect(loadSql).not.toHaveBeenCalled();
    expect(h.queries).toHaveLength(1);
  });

  it("treats the Paper Notes schema as incomplete when structured contact phone columns are missing", async () => {
    const h = client(true);
    const loadSql = vi.fn(async () => "create table should_not_run(id int);");

    await ensurePaperNotesSchema(h.client, { loadSql });

    expect(h.queries[0]).toContain("table_name = 'contact_phones'");
    expect(h.queries[0]).toContain("column_name = 'instructions'");
    expect(h.queries[0]).toContain("column_name = 'status'");
    expect(h.queries[0]).toContain("column_name = 'source_paper_note_entry_id'");
  });

  it("applies migration 066 when the live database is missing Paper Notes tables", async () => {
    const h = client(false);
    const sql = "create table if not exists paper_note_batches(id uuid);";
    const loadSql = vi.fn(async () => sql);

    await expect(ensurePaperNotesSchema(h.client, { loadSql })).resolves.toBe(true);
    expect(loadSql).toHaveBeenCalledTimes(1);
    expect(h.queries).toContain(sql);
  });
});
