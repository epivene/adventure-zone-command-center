import { describe, expect, it } from "vitest";

import { loadActReviewMigrations } from "./migrations";

describe("leaked fair fixture cleanup migration", () => {
  it("targets only the known Double-Run Fairs integration-test signature", async () => {
    const migrations = await loadActReviewMigrations();
    const migration = migrations.find(({ name }) => name === "061_cleanup_consolidation_test_fixtures.sql");

    expect(migration).toBeDefined();
    expect(migration!.markerSql).toContain("Double-Run Fairs");
    expect(migration!.markerSql).toContain("Repeat Fair A");
    expect(migration!.markerSql).toContain("Repeat Fair B");
    expect(migration!.sql).toContain("Rockford");
    expect(migration!.sql).toContain("Aurora");
    expect(migration!.sql).toMatch(/NOT EXISTS[\s\S]*organization_contacts/i);
    expect(migration!.sql).toMatch(/NOT EXISTS[\s\S]*bookings/i);
  });
});
