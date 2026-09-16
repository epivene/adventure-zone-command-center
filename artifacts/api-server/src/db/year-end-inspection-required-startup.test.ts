import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { ensureYearEndInspectionSchemaBeforeListen } from "./year-end-inspection-required-startup";

describe("ensureYearEndInspectionSchemaBeforeListen", () => {
  it("creates every table needed to preserve annual inspection evidence", async () => {
    const queries: string[] = [];
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        return { rows: [] };
      },
      release,
    };

    await expect(ensureYearEndInspectionSchemaBeforeListen({
      pool: { async connect() { return client; } },
    })).resolves.toBe(true);

    const schemaSql = queries.join("\n");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS equipment_pieces");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS equipment_piece_assignments");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS year_end_leg_inspections");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_entries");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_photos");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_maintenance_items");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_audit_events");
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed when another process owns the schema lock", async () => {
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        return sql.includes("pg_try_advisory_lock")
          ? { rows: [{ locked: false }] }
          : { rows: [] };
      },
      release,
    };

    await expect(ensureYearEndInspectionSchemaBeforeListen({
      pool: { async connect() { return client; } },
    })).rejects.toThrow("YEAR_END_INSPECTION_SCHEMA_LOCK_BUSY");
    expect(release).toHaveBeenCalledOnce();
  });
});
