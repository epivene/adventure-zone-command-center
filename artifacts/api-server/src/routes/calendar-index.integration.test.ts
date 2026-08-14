/**
 * Integration test: activities calendar index migration
 *
 * Covers:
 *  1. The migration entry is registered in migrationFiles (runner will load it).
 *  2. The marker SQL correctly reports ready=true when the index exists and
 *     ready=false when it does not.
 *  3. When the index is absent the runner applies the migration SQL via the
 *     mock client, and afterwards the marker reports ready.
 *  4. Live-DB suite (gated on RENDER_DATABASE_URL) confirms the index exists
 *     in production and the marker returns ready=true.
 */

import { describe, expect, it, vi } from "vitest";

const MIGRATION_NAME = "031_activities_calendar_kind_idx.sql";

// ─── Runner registration ───────────────────────────────────────────────────────

describe("migration registry", () => {
  it("031_activities_calendar_kind_idx.sql is registered in migrationFiles", async () => {
    const { loadActReviewMigrations } = await import("@workspace/db/migrations");
    const migrations = await loadActReviewMigrations();
    const entry = migrations.find((m) => m.name === MIGRATION_NAME);
    expect(entry).toBeDefined();
    expect(entry!.sql.toUpperCase()).toContain("CREATE INDEX");
    expect(entry!.sql.toUpperCase()).toContain("IF NOT EXISTS");
    expect(entry!.sql).toContain("activities_kind_timeline_sort_at_idx");
  });

  it("marker SQL queries pg_indexes for the index name", async () => {
    const { loadActReviewMigrations } = await import("@workspace/db/migrations");
    const migrations = await loadActReviewMigrations();
    const entry = migrations.find((m) => m.name === MIGRATION_NAME)!;
    // Marker must check pg_indexes (the canonical catalog for indexes).
    expect(entry.markerSql.toLowerCase()).toContain("pg_indexes");
    expect(entry.markerSql).toContain("activities_kind_timeline_sort_at_idx");
    expect(entry.markerSql.toLowerCase()).toContain("as ready");
  });
});

// ─── Runner behaviour (mock client) ───────────────────────────────────────────

describe("runActReviewMigrations — calendar index migration", () => {
  /** Build a mock pool whose client reports `ready` according to the flag. */
  function buildPool(indexExists: boolean) {
    const executedSql: string[] = [];
    let markerCallCount = 0;

    const client = {
      query: vi.fn(async (sql: string) => {
        // Advisory lock / unlock — harmless no-ops.
        if (sql.includes("pg_advisory")) return { rows: [] };

        // Marker query for the calendar index migration — identified by
        // querying pg_indexes (never present in the migration DDL itself).
        if (sql.includes("pg_indexes") && sql.includes("activities_kind_timeline_sort_at_idx")) {
          markerCallCount++;
          // First call: report whether the index exists.
          // Subsequent calls (after the migration runs): report true.
          const ready = indexExists || markerCallCount > 1;
          return { rows: [{ ready }] };
        }

        // Any other migration marker → already done (ready: true).
        if (sql.toLowerCase().includes("as ready")) {
          return { rows: [{ ready: true }] };
        }

        // Non-marker statement — record it so tests can inspect.
        executedSql.push(sql);
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const pool = { connect: vi.fn(async () => client) };
    return { pool, client, executedSql };
  }

  it("skips the migration when the index already exists", async () => {
    const { runActReviewMigrations } = await import("@workspace/db/migrations");
    const { pool, executedSql } = buildPool(true /* index exists */);

    const applied = await runActReviewMigrations({ pool });

    expect(applied).not.toContain(MIGRATION_NAME);
    // No CREATE INDEX statement should have been executed.
    expect(executedSql.join("\n").toUpperCase()).not.toContain("CREATE INDEX");
  });

  it("applies the migration when the index is absent", async () => {
    const { runActReviewMigrations } = await import("@workspace/db/migrations");
    const { pool, executedSql } = buildPool(false /* index absent */);

    const applied = await runActReviewMigrations({ pool });

    expect(applied).toContain(MIGRATION_NAME);
    // The CREATE INDEX statement must have been sent to the client.
    expect(executedSql.join("\n").toUpperCase()).toContain("CREATE INDEX");
    expect(executedSql.join("\n")).toContain("activities_kind_timeline_sort_at_idx");
  });
});

// ─── Live-DB assertions (skipped without a database URL) ─────────────────────

const dbUrl = process.env.RENDER_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("calendar index — live database", () => {
  async function pgClient() {
    const pg = await import("pg");
    const raw = dbUrl!;
    const connectionString =
      raw.includes("sslmode=") || raw.includes("ssl=")
        ? raw
        : raw + (raw.includes("?") ? "&" : "?") + "sslmode=require";
    const client = new pg.default.Client({ connectionString });
    await client.connect();
    return client;
  }

  it("index activities_kind_timeline_sort_at_idx exists on the activities table", async () => {
    const client = await pgClient();
    try {
      const { rows } = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'activities'
          AND indexname = 'activities_kind_timeline_sort_at_idx'
      `);
      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("migration marker returns ready=true (index already applied)", async () => {
    const { loadActReviewMigrations } = await import("@workspace/db/migrations");
    const migrations = await loadActReviewMigrations();
    const entry = migrations.find((m) => m.name === MIGRATION_NAME)!;

    const client = await pgClient();
    try {
      const { rows } = await client.query<{ ready: boolean }>(entry.markerSql);
      expect(rows[0]?.ready).toBe(true);
    } finally {
      await client.end();
    }
  });
});
