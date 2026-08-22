import { describe, expect, it } from "vitest";

import {
  loadBusinessDriveMigrations,
  runBusinessDriveMigrations,
} from "@workspace/db/business-drive-migrations";

describe("business drive migration runner", () => {
  it("loads the reviewed-source migrations in dependency order", async () => {
    const migrations = await loadBusinessDriveMigrations();
    expect(migrations.map((migration) => migration.name)).toEqual([
      "20260822_business_source_copy.sql",
      "20260822_package_reviewed_defaults.sql",
      "20260822_commercial_offer_rules.sql",
      "20260822_event_checklists.sql",
      "20260822_resource_checklist_tags.sql",
      "20260822_resource_asset_identity.sql",
      "20260822_resource_source_candidates.sql",
    ]);
  });

  it("does not consider the source migration complete without the Office template FK", async () => {
    const migrations = await loadBusinessDriveMigrations();
    const source = migrations[0];
    expect(source.markerSql).toContain("office_email_drafts_communication_template_fk");
    expect(source.sql).toContain("CREATE TABLE IF NOT EXISTS business_source_documents");
  });

  it("serializes and applies only migrations whose marker is missing", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql === "marker:source") return { rows: [{ ready: false }] };
        if (sql === "marker:offers") return { rows: [{ ready: true }] };
        return { rows: [] };
      },
      release() { queries.push("release"); },
    };

    await runBusinessDriveMigrations({
      pool: { connect: async () => client },
      migrations: [
        { name: "source", markerSql: "marker:source", sql: "migration:source" },
        { name: "offers", markerSql: "marker:offers", sql: "migration:offers" },
      ],
    });

    expect(queries).toEqual([
      "SELECT pg_advisory_lock(hashtext('adventure-zone:business-drive-migrations'))",
      "marker:source",
      "migration:source",
      "marker:offers",
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:business-drive-migrations'))",
      "release",
    ]);
  });
});
