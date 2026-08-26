import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

import { ensureLeadIntakeSchema } from "./lead-intake-startup-migration";

describe("ensureLeadIntakeSchema", () => {
  it("checks every review column plus critical constraints before declaring the schema ready", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
    const loadSql = vi.fn();

    await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence");
    expect(query.mock.calls[0]?.[0]).toContain("original_filename");
    expect(query.mock.calls[0]?.[0]).toContain("source_fingerprint");
    expect(query.mock.calls[0]?.[0]).toContain("review_version");
    expect(query.mock.calls[0]?.[0]).toContain("confirmed_recipient_email");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_rows_confirmed_date_range_valid");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_rows_selected_organization_fk");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence_source_kind_valid");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence_one_selected_field");
    expect(query.mock.calls[0]?.[0]).toContain("relationship_outcome");
    expect(query.mock.calls[0]?.[0]).toContain("relationship_classified_by");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_rows_relationship_classification_complete");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_rows_relationship_outcome_idx");
    expect(loadSql).not.toHaveBeenCalled();
  });

  it("runs both lead-intake migrations when the schema is incomplete", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ready: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ready: true }] });
    const loadSql = vi.fn().mockResolvedValue("-- base migration\n-- review evidence migration");

    await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(true);
    expect(loadSql).toHaveBeenCalledOnce();
    expect(query.mock.calls[1]?.[0]).toBe("-- base migration\n-- review evidence migration");
  });

  it("fails closed when a partial schema remains incomplete after migration", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ready: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ready: false }] });
    await expect(ensureLeadIntakeSchema({ query }, { loadSql: async () => "-- attempted repair" }))
      .rejects.toThrow("schema is incomplete after migration");
  });

  it("runs safely on an entirely empty database and then reports the complete schema ready", async () => {
    const client = new PGlite();
    const query = async (sql: string) => {
      if (sql.includes("create table if not exists lead_import_batches")) {
        await client.exec(sql);
        return { rows: [] as Array<Record<string, unknown>> };
      }
      return client.query(sql) as Promise<{ rows: Array<Record<string, unknown>> }>;
    };
    const loadSql = async () => [
      await readFile(new URL("../../../../lib/db/migrations/069_excel_lead_intake.sql", import.meta.url), "utf8"),
      await readFile(new URL("../../../../lib/db/migrations/20260825_lead_review_evidence.sql", import.meta.url), "utf8"),
      await readFile(new URL("../../../../lib/db/migrations/20260825_lead_relationship_classification.sql", import.meta.url), "utf8"),
    ].join("\n");
    try {
      await client.exec(`create table organizations (id uuid primary key); create table contacts (id uuid primary key);`);
      await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(true);
      await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(false);
    } finally {
      await client.close();
    }
  }, 15_000);
});
