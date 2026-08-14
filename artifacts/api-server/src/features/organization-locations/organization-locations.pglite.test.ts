/**
 * Integration tests for the organization_locations data model.
 *
 * Uses PGlite (in-process Postgres) so the suite runs without an external DB.
 *
 * Strategy: bootstrap a minimal pre-027 schema, then apply migrations 027 and
 * 028 from the actual SQL files in lib/db/migrations/.  This validates that the
 * shipped migrations are internally consistent and consistent with the Drizzle
 * model — rather than testing a hand-duplicated SQL definition.
 *
 * Test coverage:
 *   1. Schema write and read (all organization_locations columns)
 *   2. Cross-organization trigger on each of the five downstream tables
 *      (contacts, activities, bookings, follow_ups, call_sessions)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ── Stable UUIDs ──────────────────────────────────────────────────────────────
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOC_A = "11111111-1111-4111-8111-111111111111";
const LOC_B = "22222222-2222-4222-8222-222222222222";
const CONT  = "33333333-3333-4333-8333-333333333333";
const ACT   = "44444444-4444-4444-8444-444444444444";
const BOOK  = "55555555-5555-4555-8555-555555555555";
const FUP   = "66666666-6666-4666-8666-666666666666";
const SESS  = "77777777-7777-4777-8777-777777777777";

// ── Migration directory (shared with lib/db) ──────────────────────────────────
const MIGRATION_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../lib/db/migrations",
);

async function readMigration(filename: string) {
  return readFile(path.join(MIGRATION_DIR, filename), "utf8");
}

// ── Minimal pre-027 schema ────────────────────────────────────────────────────
// Exactly the tables that migration 027 references in its ALTER TABLE /
// REFERENCES clauses, without any organization_location_id columns.
const PRE_027_SCHEMA = `
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  name            text NOT NULL,
  city            text NOT NULL DEFAULT '',
  region          text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'new_lead',
  probability     text NOT NULL DEFAULT 'possible',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id),
  kind             text NOT NULL,
  body             text NOT NULL DEFAULT '',
  timeline_sort_at timestamptz NOT NULL DEFAULT now(),
  occurred_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE follow_ups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  kind            text NOT NULL DEFAULT 'generic',
  due_at          timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE call_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  disposition     text NOT NULL DEFAULT 'no_answer',
  started_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
`;

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();

  // 1. Pre-migration state (no organization_locations, no FKs on downstream tables)
  await client.exec(PRE_027_SCHEMA);

  // 2. Apply migration 027 — creates the table, adds FK columns, installs triggers
  const sql027 = await readMigration("027_organization_locations.sql");
  await client.exec(sql027);

  // 3. Apply migration 028 — renames address1/address2 if needed (no-op here
  //    because 027 now creates address_1/address_2 directly, but applying it
  //    validates the idempotent DO $$ … END block runs cleanly)
  const sql028 = await readMigration("028_organization_locations_address_fix.sql");
  await client.exec(sql028);

  // 4. Seed fixtures
  await client.exec(`
    INSERT INTO organizations (id, name) VALUES
      ('${ORG_A}', 'Org A'),
      ('${ORG_B}', 'Org B');

    INSERT INTO organization_locations
      (id, organization_id, label, address_1, address_2, city, region,
       postal_code, website, phone, normalized_phone, email, local_status,
       lat, lng, act_record_id, act_source_label)
    VALUES
      ('${LOC_A}', '${ORG_A}', 'Main Fairgrounds',
       '123 Fair Ln', 'Suite 4', 'Springfield', 'IL', '62701',
       'https://orga.example', '217-555-0100', '12175550100',
       'info@orga.example', 'active', 39.7817, -89.6502,
       'act-loc-a', 'Act Source A'),
      ('${LOC_B}', '${ORG_B}', 'City Hall',
       null, null, 'Shelbyville', 'IL', '62565',
       null, null, null, null, null, null, null, null, null);
  `);
});

afterAll(async () => {
  await client.close();
});

// ── 1. Schema write / read ─────────────────────────────────────────────────────

describe("organization_locations schema (applied via migration SQL)", () => {
  it("stores and retrieves all location columns", async () => {
    const result = await client.query<{
      id: string;
      organization_id: string;
      label: string;
      address_1: string | null;
      address_2: string | null;
      city: string | null;
      region: string | null;
      postal_code: string | null;
      website: string | null;
      phone: string | null;
      normalized_phone: string | null;
      email: string | null;
      local_status: string | null;
      lat: number | null;
      lng: number | null;
      act_record_id: string | null;
      act_source_label: string | null;
    }>(`SELECT * FROM organization_locations WHERE id = '${LOC_A}'`);

    const row = result.rows[0];
    expect(row).toBeDefined();
    expect(row.organization_id).toBe(ORG_A);
    expect(row.label).toBe("Main Fairgrounds");
    expect(row.address_1).toBe("123 Fair Ln");
    expect(row.address_2).toBe("Suite 4");
    expect(row.city).toBe("Springfield");
    expect(row.region).toBe("IL");
    expect(row.postal_code).toBe("62701");
    expect(row.website).toBe("https://orga.example");
    expect(row.phone).toBe("217-555-0100");
    expect(row.normalized_phone).toBe("12175550100");
    expect(row.email).toBe("info@orga.example");
    expect(row.local_status).toBe("active");
    expect(row.lat).toBeCloseTo(39.7817);
    expect(row.lng).toBeCloseTo(-89.6502);
    expect(row.act_record_id).toBe("act-loc-a");
    expect(row.act_source_label).toBe("Act Source A");
  });

  it("address columns are named address_1 and address_2 (underscore convention)", async () => {
    // Confirms migration 028 renamed any old address1/address2 columns if present
    const result = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'organization_locations'
        AND column_name IN ('address_1', 'address_2', 'address1', 'address2')
      ORDER BY column_name
    `);
    const names = result.rows.map((r) => r.column_name);
    expect(names).toContain("address_1");
    expect(names).toContain("address_2");
    expect(names).not.toContain("address1");
    expect(names).not.toContain("address2");
  });

  it("enforces the unique constraint on act_record_id", async () => {
    await expect(
      client.query(`
        INSERT INTO organization_locations (organization_id, label, act_record_id)
        VALUES ('${ORG_A}', 'Duplicate', 'act-loc-a')
      `),
    ).rejects.toThrow();
  });

  it("allows a location with all nullable fields set to null", async () => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM organization_locations WHERE id = '${LOC_B}'`,
    );
    expect(result.rows[0]).toBeDefined();
  });

  it("rejects a location with no organization_id", async () => {
    await expect(
      client.query(`INSERT INTO organization_locations (label) VALUES ('No Org')`),
    ).rejects.toThrow();
  });

  it("all five downstream tables have the organization_location_id column", async () => {
    const result = await client.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.columns
      WHERE column_name = 'organization_location_id'
        AND table_name IN ('contacts', 'activities', 'bookings', 'follow_ups', 'call_sessions')
      ORDER BY table_name
    `);
    const tables = result.rows.map((r) => r.table_name);
    expect(tables).toContain("contacts");
    expect(tables).toContain("activities");
    expect(tables).toContain("bookings");
    expect(tables).toContain("follow_ups");
    expect(tables).toContain("call_sessions");
  });
});

// ── 2. Cross-org trigger — one sub-suite per downstream table ─────────────────

describe("cross-org trigger: contacts", () => {
  it("allows a contact pinned to a location in the same org", async () => {
    await expect(
      client.query(`
        INSERT INTO contacts (id, organization_id, organization_location_id, first_name, last_name)
        VALUES ('${CONT}', '${ORG_A}', '${LOC_A}', 'Alice', 'Smith')
      `),
    ).resolves.toBeDefined();
  });

  it("blocks a contact pinned to a location in a different org", async () => {
    await expect(
      client.query(`
        INSERT INTO contacts (organization_id, organization_location_id, first_name, last_name)
        VALUES ('${ORG_B}', '${LOC_A}', 'Bad', 'Actor')
      `),
    ).rejects.toThrow(/does not belong to organization_id/);
  });

  it("allows a contact with organization_location_id = null", async () => {
    await expect(
      client.query(`
        INSERT INTO contacts (organization_id, first_name, last_name)
        VALUES ('${ORG_A}', 'Unpinned', 'Contact')
      `),
    ).resolves.toBeDefined();
  });

  it("blocks UPDATE that moves a contact to a mismatched location", async () => {
    await expect(
      client.query(`
        UPDATE contacts SET organization_location_id = '${LOC_B}'
        WHERE id = '${CONT}'
      `),
    ).rejects.toThrow(/does not belong to organization_id/);
  });
});

describe("cross-org trigger: activities", () => {
  it("allows an activity pinned to a matching location", async () => {
    await expect(
      client.query(`
        INSERT INTO activities (id, organization_id, organization_location_id, kind, body)
        VALUES ('${ACT}', '${ORG_A}', '${LOC_A}', 'note', 'test')
      `),
    ).resolves.toBeDefined();
  });

  it("blocks an activity pinned to a mismatched location", async () => {
    await expect(
      client.query(`
        INSERT INTO activities (organization_id, organization_location_id, kind, body)
        VALUES ('${ORG_B}', '${LOC_A}', 'note', 'bad')
      `),
    ).rejects.toThrow(/does not belong to organization_id/);
  });
});

describe("cross-org trigger: bookings", () => {
  it("allows a booking pinned to a matching location", async () => {
    await expect(
      client.query(`
        INSERT INTO bookings (id, organization_id, organization_location_id, name)
        VALUES ('${BOOK}', '${ORG_A}', '${LOC_A}', 'Booking A')
      `),
    ).resolves.toBeDefined();
  });

  it("blocks a booking pinned to a mismatched location", async () => {
    await expect(
      client.query(`
        INSERT INTO bookings (organization_id, organization_location_id, name)
        VALUES ('${ORG_B}', '${LOC_A}', 'Bad Booking')
      `),
    ).rejects.toThrow(/does not belong to organization_id/);
  });
});

describe("cross-org trigger: follow_ups", () => {
  it("allows a follow-up pinned to a matching location", async () => {
    await expect(
      client.query(`
        INSERT INTO follow_ups (id, organization_id, organization_location_id, kind, due_at)
        VALUES ('${FUP}', '${ORG_A}', '${LOC_A}', 'call', now())
      `),
    ).resolves.toBeDefined();
  });

  it("blocks a follow-up pinned to a mismatched location", async () => {
    await expect(
      client.query(`
        INSERT INTO follow_ups (organization_id, organization_location_id, kind, due_at)
        VALUES ('${ORG_B}', '${LOC_A}', 'call', now())
      `),
    ).rejects.toThrow(/does not belong to organization_id/);
  });
});

describe("cross-org trigger: call_sessions", () => {
  it("allows a session pinned to a matching location", async () => {
    await expect(
      client.query(`
        INSERT INTO call_sessions (id, organization_id, organization_location_id, disposition, started_at)
        VALUES ('${SESS}', '${ORG_A}', '${LOC_A}', 'no_answer', now())
      `),
    ).resolves.toBeDefined();
  });

  it("blocks a session pinned to a mismatched location", async () => {
    await expect(
      client.query(`
        INSERT INTO call_sessions (organization_id, organization_location_id, disposition, started_at)
        VALUES ('${ORG_B}', '${LOC_A}', 'no_answer', now())
      `),
    ).rejects.toThrow(/does not belong to organization_id/);
  });
});
