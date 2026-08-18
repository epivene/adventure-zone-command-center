import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const migrationsSource = readFileSync("../../lib/db/src/migrations.ts", "utf8");
const migrationSql = readFileSync("../../lib/db/migrations/044_finance_admin_evidence.sql", "utf8");
describe("finance admin evidence migration", () => {
  it("registers assignment provenance, submitter snapshot and audit history", () => {
    expect(migrationsSource).toContain('name: "044_finance_admin_evidence.sql"');
    expect(migrationSql).toContain("assignment_source");
    expect(migrationSql).toContain("submitted_by_label");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS leg_finance_audit");
    expect(migrationSql).toContain("previous_values jsonb NOT NULL");
    expect(migrationSql).toContain("new_values jsonb NOT NULL");
  });
  it("preserves legacy scope and marks new scoped submissions explicit", () => {
    expect(migrationSql).toContain("THEN 'legacy'");
    expect(migrationSql).toContain("ELSE 'unassigned'");
    expect(migrationSql).toContain("NEW.assignment_source := 'explicit'");
    expect(migrationSql).toContain("SELECT manager_name INTO NEW.submitted_by_label");
  });
});
