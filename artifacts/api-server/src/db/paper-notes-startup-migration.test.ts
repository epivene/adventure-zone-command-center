import { describe, expect, it, vi } from "vitest";

import { ensurePaperNotesSchema } from "./paper-notes-startup-migration";

function client(
  baseReady: boolean,
  missingContactPhoneColumns: string[] = [],
) {
  const queries: string[] = [];
  return {
    queries,
    client: {
      async query(sql: string) {
        queries.push(sql);
        const normalizedSql = sql.toLowerCase();
        if (
          normalizedSql.includes("paper_note_batches") &&
          normalizedSql.includes("paper_note_pages") &&
          normalizedSql.includes("as ready")
        ) {
          const checkedMissingColumn = missingContactPhoneColumns.some((column) =>
            normalizedSql.includes(`column_name = '${column}'`),
          );
          return { rows: [{ ready: baseReady && !checkedMissingColumn }] };
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

  it.each([
    "instructions",
    "status",
    "source_paper_note_entry_id",
  ])(
    "reruns migration 066 when contact_phones.%s is missing",
    async (missingColumn) => {
      const h = client(true, [missingColumn]);
      const sql = "alter table contact_phones add column repaired text;";
      const loadSql = vi.fn(async () => sql);

      await expect(ensurePaperNotesSchema(h.client, { loadSql })).resolves.toBe(true);
      expect(loadSql).toHaveBeenCalledTimes(1);
      expect(h.queries).toContain(sql);
    },
  );

  it("applies migration 066 when the live database is missing Paper Notes tables", async () => {
    const h = client(false);
    const sql = "create table if not exists paper_note_batches(id uuid);";
    const loadSql = vi.fn(async () => sql);

    await expect(ensurePaperNotesSchema(h.client, { loadSql })).resolves.toBe(true);
    expect(loadSql).toHaveBeenCalledTimes(1);
    expect(h.queries).toContain(sql);
  });
});
