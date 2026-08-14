import { describe, expect, it } from "vitest";

import { loadActReviewMigrations } from "../../../../lib/db/src/migrations";

describe("033 organization location cleanup migration", () => {
  it("backfills only a unanimous booking leg and keeps leg deletion safe", async () => {
    const migration = (await loadActReviewMigrations()).find(
      ({ name }) => name === "033_retire_organization_hierarchy.sql",
    );
    expect(migration?.sql).toContain("HAVING count(DISTINCT travel_leg_id) = 1");
    expect(migration?.sql).toContain("REFERENCES travel_legs(id) ON DELETE SET NULL");
  });

  it("moves hierarchy records before dropping the legacy column", async () => {
    const sql = (await loadActReviewMigrations()).find(
      ({ name }) => name === "033_retire_organization_hierarchy.sql",
    )!.sql;
    const move = sql.indexOf("UPDATE contacts SET organization_id");
    const retire = sql.indexOf("consolidated_into_id = child.parent_organization_id");
    const drop = sql.indexOf("DROP COLUMN IF EXISTS parent_organization_id");
    expect(move).toBeGreaterThan(0);
    expect(retire).toBeGreaterThan(move);
    expect(drop).toBeGreaterThan(retire);
    expect(sql).toContain("consolidation_source_org_id = child.id");
  });
});
