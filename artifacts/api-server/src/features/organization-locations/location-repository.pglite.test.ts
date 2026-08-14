/**
 * Integration tests for DrizzleLocationRepository.
 *
 * Uses PGlite (in-process Postgres-compatible) so no external DB is required.
 * The test schema is bootstrapped from the actual migration SQL files so the
 * repository is tested against the real shipped schema.
 *
 * Coverage:
 *  1. findByOrganization — returns location summaries with LATERAL joins
 *  2. findById — returns full detail or null
 *  3. create — inserts and returns the new id; normalizes website
 *  4. update — patches fields; website normalization applied
 *  5. remove — returns "ok" on an empty location
 *  6. remove — returns "has_dependents" when a contact is pinned
 *  7. remove — returns "not_found" for an unknown id
 *  8. rollupForOrganization — counts locations, upcoming bookings, overdue follow-ups
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DrizzleLocationRepository } from "./location-repository";

// ── Stable UUIDs ──────────────────────────────────────────────────────────────
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOC_1 = "11111111-1111-4111-8111-111111111111";
const LOC_2 = "22222222-2222-4222-8222-222222222222";
const CONT  = "33333333-3333-4333-8333-333333333333";
const BOOK  = "44444444-4444-4444-8444-444444444444";
const FUP   = "55555555-5555-4555-8555-555555555555";

const MIGRATION_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../lib/db/migrations",
);

async function readMigration(filename: string): Promise<string> {
  return readFile(path.join(MIGRATION_DIR, filename), "utf8");
}

// ── Minimal schema for location tests (no Act! tables) ────────────────────────
const BASE_SCHEMA = `
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  phone           text,
  email           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE travel_legs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  color       text NOT NULL,
  sort_order  integer NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  travel_leg_id   uuid REFERENCES travel_legs(id),
  name            text NOT NULL,
  city            text NOT NULL DEFAULT '',
  region          text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'new_lead',
  probability     text NOT NULL DEFAULT 'possible',
  starts_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id),
  contact_id       uuid,
  booking_id       uuid,
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
  contact_id      uuid,
  booking_id      uuid,
  kind            text NOT NULL DEFAULT 'call',
  due_at          timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_id      uuid NOT NULL REFERENCES contacts(id),
  role            text,
  is_primary      boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  source          text NOT NULL DEFAULT 'local',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, contact_id)
);

CREATE TABLE call_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  disposition     text NOT NULL,
  started_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
`;

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let repo: DrizzleLocationRepository;

beforeAll(async () => {
  client = new PGlite();

  // Apply the base schema, then migration 027 (adds organization_locations +
  // organizationLocationId FK columns), then migration 028 (address fix).
  const [migration027, migration028] = await Promise.all([
    readMigration("027_organization_locations.sql"),
    readMigration("028_organization_locations_address_fix.sql"),
  ]);

  await client.exec(BASE_SCHEMA);
  await client.exec(migration027);
  await client.exec(migration028);

  // Seed two organizations.
  await client.exec(`
    INSERT INTO organizations (id, name) VALUES
      ('${ORG_A}', 'Org Alpha'),
      ('${ORG_B}', 'Org Beta');
  `);

  // Seed two locations for ORG_A.
  await client.exec(`
    INSERT INTO organization_locations
      (id, organization_id, label, venue_name, city, region, website,
       phone, email, local_status, lat, lng)
    VALUES
      ('${LOC_1}', '${ORG_A}', 'Main Stage', 'Grand Arena', 'Springfield', 'IL',
       'example.com', '555-1234', 'main@example.com', 'active', 39.78, -89.65),
      ('${LOC_2}', '${ORG_A}', 'Side Stage', null, 'Shelbyville', 'IL',
       null, null, null, null, null, null);
  `);

  // Seed a contact linked to LOC_1.
  await client.exec(`
    INSERT INTO contacts (id, organization_id, organization_location_id, first_name, last_name)
    VALUES ('${CONT}', '${ORG_A}', '${LOC_1}', 'Jane', 'Doe');
  `);

  // Seed a future booking on ORG_A (not pinned to a location).
  await client.exec(`
    INSERT INTO bookings (id, organization_id, name, starts_at, status)
    VALUES ('${BOOK}', '${ORG_A}', 'Summer Show',
      now() + interval '30 days', 'confirmed');
  `);

  // Seed an overdue follow-up on ORG_A.
  await client.exec(`
    INSERT INTO follow_ups (id, organization_id, kind, due_at, organization_location_id)
    VALUES ('${FUP}', '${ORG_A}', 'call', now() - interval '1 day', '${LOC_1}');
  `);

  db = drizzle(client);
  repo = new DrizzleLocationRepository(db as never);
}, 30_000);

afterAll(async () => {
  await client.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("findByOrganization", () => {
  it("returns location summaries for the given org only", async () => {
    const summaries = await repo.findByOrganization(ORG_A);
    // LOC_1 "Main Stage" and LOC_2 "Side Stage" — may have extras from other tests
    const labels = summaries.map((s) => s.label);
    expect(labels).toContain("Main Stage");
    expect(labels).toContain("Side Stage");
  });

  it("returns no locations for an org with none", async () => {
    const summaries = await repo.findByOrganization(ORG_B);
    expect(summaries).toHaveLength(0);
  });

  it("includes coordinate when lat/lng are set", async () => {
    const summaries = await repo.findByOrganization(ORG_A);
    const main = summaries.find((s) => s.label === "Main Stage")!;
    expect(main.coordinate).toEqual({ lat: 39.78, lng: -89.65 });
  });

  it("returns null coordinate when lat/lng are absent", async () => {
    const summaries = await repo.findByOrganization(ORG_A);
    const side = summaries.find((s) => s.label === "Side Stage")!;
    expect(side.coordinate).toBeNull();
  });

  it("includes the open follow-up for Main Stage", async () => {
    const summaries = await repo.findByOrganization(ORG_A);
    const main = summaries.find((s) => s.label === "Main Stage")!;
    expect(main.nextFollowUp).not.toBeNull();
    expect(main.nextFollowUp?.kind).toBe("call");
  });

  it("does not show a cancelled or declined booking as nextBooking", async () => {
    const LOC_ACTIVE = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
    const BK_CANCELLED = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
    const BK_ACTIVE    = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
    // Create an isolated location on ORG_B so it doesn't pollute ORG_A counts.
    await client.exec(`
      INSERT INTO organization_locations (id, organization_id, label)
      VALUES ('${LOC_ACTIVE}', '${ORG_B}', 'Status Filter Loc');
    `);
    // A cancelled booking sooner than the active one.
    await client.exec(`
      INSERT INTO bookings (id, organization_id, organization_location_id, name, starts_at, status)
      VALUES
        ('${BK_CANCELLED}', '${ORG_B}', '${LOC_ACTIVE}', 'Cancelled Show', now() + interval '5 days', 'cancelled'),
        ('${BK_ACTIVE}',    '${ORG_B}', '${LOC_ACTIVE}', 'Active Show',    now() + interval '10 days', 'confirmed');
    `);
    const summaries = await repo.findByOrganization(ORG_B);
    const loc = summaries.find((s) => s.id === LOC_ACTIVE)!;
    expect(loc.nextBooking).not.toBeNull();
    expect(loc.nextBooking?.name).toBe("Active Show");
    // Cleanup.
    await client.exec(`DELETE FROM bookings WHERE id IN ('${BK_CANCELLED}', '${BK_ACTIVE}')`);
    await client.exec(`DELETE FROM organization_locations WHERE id = '${LOC_ACTIVE}'`);
  });
});

describe("findById", () => {
  it("returns full detail for an existing location", async () => {
    const detail = await repo.findById(ORG_A, LOC_1);
    expect(detail).not.toBeNull();
    expect(detail?.label).toBe("Main Stage");
    expect(detail?.venueName).toBe("Grand Arena");
    expect(detail?.website).toBe("example.com"); // stored as-is (not normalized on read)
    expect(detail?.email).toBe("main@example.com");
  });

  it("includes contacts pinned to the location", async () => {
    const detail = await repo.findById(ORG_A, LOC_1);
    expect(detail?.contacts).toHaveLength(1);
    expect(detail?.contacts[0]?.name).toBe("Jane Doe");
  });

  it("returns null for a location in a different org", async () => {
    const detail = await repo.findById(ORG_B, LOC_1);
    expect(detail).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    const detail = await repo.findById(ORG_A, "00000000-0000-4000-8000-000000000000");
    expect(detail).toBeNull();
  });
});

describe("create", () => {
  it("inserts a location and returns its id", async () => {
    const now = new Date();
    const { id } = await repo.create(ORG_A, { label: "New Venue", city: "Chicago", region: "IL" }, now);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("normalizes a website without a protocol on create", async () => {
    const now = new Date();
    const { id } = await repo.create(ORG_A, { label: "Protocol Test", website: "mysite.com" }, now);
    const detail = await repo.findById(ORG_A, id);
    expect(detail?.website).toBe("https://mysite.com");
  });

  it("preserves an existing https:// prefix on create", async () => {
    const now = new Date();
    const { id } = await repo.create(ORG_A, { label: "HTTPS Test", website: "https://secure.com" }, now);
    const detail = await repo.findById(ORG_A, id);
    expect(detail?.website).toBe("https://secure.com");
  });

  it("stores normalized_phone on create when a valid NA phone is supplied", async () => {
    const { id } = await repo.create(ORG_A, { label: "Phone Test", phone: "(312) 555-9876" }, new Date());
    const [row] = (await client.query<{ normalized_phone: string | null }>(
      `SELECT normalized_phone FROM organization_locations WHERE id = '${id}'`,
    )).rows;
    expect(row?.normalized_phone).toBe("+13125559876");
  });

  it("stores null normalized_phone when the phone cannot be canonicalized", async () => {
    const { id } = await repo.create(ORG_A, { label: "Intl Phone Test", phone: "555-CALL" }, new Date());
    const [row] = (await client.query<{ normalized_phone: string | null }>(
      `SELECT normalized_phone FROM organization_locations WHERE id = '${id}'`,
    )).rows;
    expect(row?.normalized_phone).toBeNull();
  });

  it("stores null normalized_phone when phone is absent", async () => {
    const { id } = await repo.create(ORG_A, { label: "No Phone" }, new Date());
    const [row] = (await client.query<{ normalized_phone: string | null }>(
      `SELECT normalized_phone FROM organization_locations WHERE id = '${id}'`,
    )).rows;
    expect(row?.normalized_phone).toBeNull();
  });

  it("throws INCOMPLETE_COORDINATE when only lat is supplied", async () => {
    await expect(
      repo.create(ORG_A, { label: "Bad Coord", lat: 41.8 }, new Date()),
    ).rejects.toThrow("INCOMPLETE_COORDINATE");
  });

  it("throws for an unknown organization", async () => {
    await expect(
      repo.create("00000000-0000-4000-8000-000000000000", { label: "Ghost Venue" }, new Date()),
    ).rejects.toThrow("ORGANIZATION_NOT_FOUND");
  });
});

describe("update", () => {
  it("patches a location label", async () => {
    const now = new Date();
    const { id } = await repo.create(ORG_A, { label: "Before Update" }, now);
    const updated = await repo.update(ORG_A, id, { label: "After Update" }, new Date());
    expect(updated).toBe(true);
    const detail = await repo.findById(ORG_A, id);
    expect(detail?.label).toBe("After Update");
  });

  it("normalizes a website without protocol on update", async () => {
    const now = new Date();
    const { id } = await repo.create(ORG_A, { label: "Website Update Test" }, now);
    await repo.update(ORG_A, id, { website: "newsite.org" }, new Date());
    const detail = await repo.findById(ORG_A, id);
    expect(detail?.website).toBe("https://newsite.org");
  });

  it("updates normalized_phone when phone changes", async () => {
    const { id } = await repo.create(ORG_A, { label: "Phone Update" }, new Date());
    await repo.update(ORG_A, id, { phone: "(773) 555-0001" }, new Date());
    const [row] = (await client.query<{ normalized_phone: string | null }>(
      `SELECT normalized_phone FROM organization_locations WHERE id = '${id}'`,
    )).rows;
    expect(row?.normalized_phone).toBe("+17735550001");
  });

  it("clears normalized_phone when phone is cleared", async () => {
    const { id } = await repo.create(ORG_A, { label: "Clear Phone", phone: "(312) 555-1111" }, new Date());
    await repo.update(ORG_A, id, { phone: null }, new Date());
    const [row] = (await client.query<{ normalized_phone: string | null }>(
      `SELECT normalized_phone FROM organization_locations WHERE id = '${id}'`,
    )).rows;
    expect(row?.normalized_phone).toBeNull();
  });

  it("throws INCOMPLETE_COORDINATE when only lng is supplied on update", async () => {
    const { id } = await repo.create(ORG_A, { label: "Coord Update" }, new Date());
    await expect(
      repo.update(ORG_A, id, { lng: -87.6 }, new Date()),
    ).rejects.toThrow("INCOMPLETE_COORDINATE");
  });

  it("returns false when the location does not exist", async () => {
    const result = await repo.update(
      ORG_A,
      "00000000-0000-4000-8000-000000000000",
      { label: "Ghost" },
      new Date(),
    );
    expect(result).toBe(false);
  });

  it("returns false when the location belongs to a different org", async () => {
    const result = await repo.update(ORG_B, LOC_1, { label: "Cross-org" }, new Date());
    expect(result).toBe(false);
  });
});

describe("remove", () => {
  it("returns 'has_dependents' when a contact is pinned to the location", async () => {
    // LOC_1 has CONT pinned to it.
    const result = await repo.remove(ORG_A, LOC_1);
    expect(result).toBe("has_dependents");
  });

  it("returns 'not_found' for an unknown location id", async () => {
    const result = await repo.remove(ORG_A, "00000000-0000-4000-8000-000000000000");
    expect(result).toBe("not_found");
  });

  it("returns 'not_found' when the location belongs to a different org", async () => {
    const result = await repo.remove(ORG_B, LOC_1);
    expect(result).toBe("not_found");
  });

  it("returns 'ok' and deletes an empty location", async () => {
    const { id } = await repo.create(ORG_A, { label: "Temp Location" }, new Date());
    const result = await repo.remove(ORG_A, id);
    expect(result).toBe("ok");
    const detail = await repo.findById(ORG_A, id);
    expect(detail).toBeNull();
  });
});

describe("rollupForOrganization", () => {
  it("returns location count for ORG_A", async () => {
    const rollup = await repo.rollupForOrganization(ORG_A);
    // LOC_1, LOC_2, plus several created during the create/update tests above.
    expect(rollup.locationCount).toBeGreaterThanOrEqual(2);
  });

  it("returns 0 location count for ORG_B", async () => {
    const rollup = await repo.rollupForOrganization(ORG_B);
    expect(rollup.locationCount).toBe(0);
  });

  it("counts upcoming bookings", async () => {
    const rollup = await repo.rollupForOrganization(ORG_A);
    // BOOK has starts_at = now() + 30 days with status 'confirmed'.
    expect(rollup.upcomingBookingCount).toBeGreaterThanOrEqual(1);
  });

  it("counts overdue follow-ups", async () => {
    const rollup = await repo.rollupForOrganization(ORG_A);
    // FUP has due_at = now() - 1 day, no completed_at.
    expect(rollup.overdueFollowUpCount).toBeGreaterThanOrEqual(1);
  });

  it("returns zero counts for org with no records", async () => {
    const rollup = await repo.rollupForOrganization(ORG_B);
    expect(rollup.upcomingBookingCount).toBe(0);
    expect(rollup.overdueFollowUpCount).toBe(0);
    expect(rollup.travelLegs).toHaveLength(0);
    expect(rollup.mostRecentActivityAt).toBeNull();
  });
});
