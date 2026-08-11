import { describe, expect, it } from "vitest";

import { loadActReviewMigrations, runActReviewMigrations } from "@workspace/db/migrations";

describe("runActReviewMigrations", () => {
  it("loads the approval provenance migration with a two-column marker", async () => {
    const migrations = await loadActReviewMigrations();
    const provenance = migrations.find((migration) => migration.name === "019_act_approval_provenance.sql");

    expect(provenance).toBeDefined();
    expect(provenance?.markerSql).toContain("COUNT(*) = 2");
    expect(provenance?.markerSql).toContain("approval_mode");
    expect(provenance?.markerSql).toContain("approval_mode_version");
  });

  it("serializes schema repair and applies only migrations whose marker is missing", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql === "marker:014") return { rows: [{ ready: false }] };
        if (sql === "marker:015") return { rows: [{ ready: true }] };
        return { rows: [] };
      },
      release() {
        queries.push("release");
      },
    };

    await runActReviewMigrations({
      pool: { connect: async () => client },
      migrations: [
        { name: "014", markerSql: "marker:014", sql: "migration:014" },
        { name: "015", markerSql: "marker:015", sql: "migration:015" },
      ],
    });

    expect(queries).toEqual([
      "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))",
      "marker:014",
      "migration:014",
      "marker:015",
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:act-review-migrations'))",
      "release",
    ]);
  });

  it("rolls back and releases the advisory lock when a migration fails", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql === "marker:014") return { rows: [{ ready: false }] };
        if (sql === "migration:014") throw new Error("migration failed");
        return { rows: [] };
      },
      release() {
        queries.push("release");
      },
    };

    await expect(
      runActReviewMigrations({
        pool: { connect: async () => client },
        migrations: [
          { name: "014", markerSql: "marker:014", sql: "migration:014" },
        ],
      }),
    ).rejects.toThrow("migration failed");

    expect(queries).toEqual([
      "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))",
      "marker:014",
      "migration:014",
      "ROLLBACK",
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:act-review-migrations'))",
      "release",
    ]);
  });
});
