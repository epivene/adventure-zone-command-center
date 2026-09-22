import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { loadActReviewMigrations } from "./migrations";

const clients: PGlite[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("event date coverage migration", () => {
  it("is registered with the startup migration runner", async () => {
    const migrations = await loadActReviewMigrations();

    expect(migrations.map((migration) => migration.name)).toContain(
      "20260921_event_date_coverage.sql",
    );
  });

  it("is idempotent and preserves existing organizations and bookings", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      CREATE TABLE organizations (
        id uuid PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE bookings (
        id uuid PRIMARY KEY,
        organization_id uuid REFERENCES organizations(id),
        starts_at timestamptz,
        ends_at timestamptz
      );
      INSERT INTO organizations (id, name)
      VALUES ('11111111-1111-4111-8111-111111111111', 'Existing Event');
      INSERT INTO bookings (id, organization_id, starts_at, ends_at)
      VALUES (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '2026-09-05T12:00:00Z',
        '2026-09-07T12:00:00Z'
      );
    `);
    const before = await client.query<{
      organization_count: number;
      booking_count: number;
      starts_at: string;
      ends_at: string;
    }>(`
      SELECT
        (SELECT count(*)::int FROM organizations) AS organization_count,
        (SELECT count(*)::int FROM bookings) AS booking_count,
        starts_at::text,
        ends_at::text
      FROM bookings
    `);
    const migration = await readFile(
      new URL("../migrations/20260921_event_date_coverage.sql", import.meta.url),
      "utf8",
    );

    await client.exec(migration);
    await client.exec(migration);

    const after = await client.query(`
      SELECT
        (SELECT count(*)::int FROM organizations) AS organization_count,
        (SELECT count(*)::int FROM bookings) AS booking_count,
        starts_at::text,
        ends_at::text
      FROM bookings
    `);
    expect(after.rows).toEqual(before.rows);
    const tables = await client.query<{ name: string }>(`
      SELECT tablename AS name
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename LIKE 'event_date_%'
      ORDER BY tablename
    `);
    expect(tables.rows.map((row) => row.name)).toEqual([
      "event_date_coverage_items",
      "event_date_coverage_runs",
      "event_date_facts",
    ]);
  });
});
