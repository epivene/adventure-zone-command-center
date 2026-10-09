import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { shouldApplyMigration } from "./migration-scope";

describe("automatic merge migration scope", () => {
  it("leaves guarded business imports pending without weakening explicit runs", () => {
    for (const file of ["20260910_public_directory_leads.sql", "20260910_rmaf_online_directory.sql"]) {
      expect(shouldApplyMigration(file, true)).toBe(false);
      expect(shouldApplyMigration(file, false)).toBe(true);
    }
    expect(shouldApplyMigration("20261009_festival_crew_stops.sql", true)).toBe(true);
    expect(shouldApplyMigration("future_schema_upgrade.sql", true)).toBe(true);
  });
  it("creates audit schema repeatably without importing organizations or contacts", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE contacts(id uuid PRIMARY KEY);");
      const schema = readFileSync(new URL("../migrations/20261009_directory_import_audit_schema.sql", import.meta.url), "utf8");
      await db.exec(schema); await db.exec(schema);
      expect((await db.query("SELECT * FROM organizations")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM contacts")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM directory_import_records")).rows).toEqual([]);
    } finally { await db.close(); }
  }, 20_000);
});
