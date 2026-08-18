import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationsSource = readFileSync("../../lib/db/src/migrations.ts", "utf8");
const migrationSql = readFileSync("../../lib/db/migrations/044_finance_admin_evidence.sql", "utf8");

describe("finance admin evidence migration", () => {
  it("registers migration 044 and creates assignment provenance plus audit history", () => {
    expect(migrationsSource).toContain('name: "044_finance_admin_evidence.sql"');
    expect(migrationsSource).toContain("assignment_source");
    expect(migrationsSource).toContain("leg_finance_audit");

    expect(migrationSql).toContain("ALTER TABLE leg_expenses");
    expect(migrationSql).toContain("assignment_source");
    expect(migrationSql).toContain("assignment_reason");
    expect(migrationSql).toContain("assignment_updated_at");
    expect(migrationSql).toContain("submitted_by_label");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS leg_finance_audit");
    expect(migrationSql).toContain("previous_values jsonb NOT NULL");
    expect(migrationSql).toContain("new_values jsonb NOT NULL");
  });

  it("backfills legacy assignments without inventing event or travel links", () => {
    expect(migrationSql).toContain("booking_id IS NOT NULL OR trip_id IS NOT NULL OR trip_segment_id IS NOT NULL");
    expect(migrationSql).toContain("THEN 'legacy'");
    expect(migrationSql).toContain("ELSE 'unassigned'");
  });

  it("snapshots the manager name and marks new scoped expenses explicit", () => {
    expect(migrationSql).toContain("leg_expenses_set_initial_assignment_source");
    expect(migrationSql).toContain("NEW.assignment_source := 'explicit'");
    expect(migrationSql).toContain("SELECT manager_name INTO NEW.submitted_by_label");
  });
});
