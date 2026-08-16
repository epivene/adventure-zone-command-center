import { describe, expect, it } from "vitest";

import { loadActReviewMigrations } from "./migrations";

describe("ACT archive full recovery schema", () => {
  it("registers a durable recovery migration and exports its tables", async () => {
    const migrations = await loadActReviewMigrations();
    const migration = migrations.find(({ name }) => name === "043_act_archive_full_recovery.sql");

    expect(migration).toBeDefined();
    expect(migration?.markerSql).toContain("act_archive_recovery_runs");
    expect(migration?.markerSql).toContain("act_archive_recovery_items");
    expect(migration?.markerSql).toContain("act_archive_recovery_decisions");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS act_archive_recovery_runs");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS act_archive_recovery_items");
    expect(migration?.sql).toContain("CREATE TABLE IF NOT EXISTS act_archive_recovery_decisions");
    expect(migration?.sql).toContain("act_archive_recovery_items_run_source_unique");
    expect(migration?.sql).toContain("lease_expires_at");
    expect(migration?.sql).toContain("retry_after");

    const schema = await import("./schema/index");
    expect("actArchiveRecoveryRuns" in schema).toBe(true);
    expect("actArchiveRecoveryItems" in schema).toBe(true);
    expect("actArchiveRecoveryDecisions" in schema).toBe(true);
  });
});
