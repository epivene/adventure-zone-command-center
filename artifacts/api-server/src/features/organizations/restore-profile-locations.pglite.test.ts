import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  listRestorableProfileLocations,
  restoreAllProfileLocations,
} from "./restore-profile-locations";

const canonicalId = "10000000-0000-4000-8000-000000000001";
const sourceA = "10000000-0000-4000-8000-000000000002";
const sourceB = "10000000-0000-4000-8000-000000000003";
const locationA = "20000000-0000-4000-8000-000000000001";
const locationB = "20000000-0000-4000-8000-000000000002";
const manualLocation = "20000000-0000-4000-8000-000000000003";
const contactA = "30000000-0000-4000-8000-000000000001";
const contactB = "30000000-0000-4000-8000-000000000002";
const bookingA = "40000000-0000-4000-8000-000000000001";
const bookingB = "40000000-0000-4000-8000-000000000002";
const activityA = "50000000-0000-4000-8000-000000000001";
const followUpA = "60000000-0000-4000-8000-000000000001";
const callA = "70000000-0000-4000-8000-000000000001";
const scopedNoteA = "80000000-0000-4000-8000-000000000001";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null,
      consolidated_into_id uuid,
      consolidated_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table organization_locations (
      id uuid primary key,
      organization_id uuid not null,
      label text not null,
      city text,
      region text,
      consolidation_source_org_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table contacts (
      id uuid primary key,
      organization_id uuid,
      organization_location_id uuid,
      first_name text not null,
      last_name text not null,
      updated_at timestamptz not null default now()
    );
    create table organization_contacts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      contact_id uuid not null,
      role text,
      is_primary boolean not null default false,
      active boolean not null default true,
      source text not null default 'local',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (organization_id, contact_id)
    );
    create table bookings (
      id uuid primary key,
      organization_id uuid,
      organization_location_id uuid,
      name text not null,
      city text not null,
      region text not null,
      updated_at timestamptz not null default now()
    );
    create table activities (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid,
      organization_location_id uuid,
      kind text not null,
      body text not null,
      occurred_at timestamptz,
      timeline_sort_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table follow_ups (
      id uuid primary key,
      organization_id uuid,
      organization_location_id uuid,
      kind text not null,
      due_at timestamptz not null,
      updated_at timestamptz not null default now()
    );
    create table call_sessions (
      id uuid primary key,
      organization_id uuid,
      organization_location_id uuid
    );
    create table event_family_members (
      id uuid primary key default gen_random_uuid(),
      family_id uuid not null,
      organization_id uuid not null
    );
    create table scoped_notes (
      id uuid primary key,
      organization_location_id uuid,
      event_family_id uuid,
      body text not null,
      source text not null default 'local',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  return { client, db: drizzle(client, { schema }) };
}

async function seed(client: PGlite) {
  await client.exec(`
    insert into organizations (id, name, consolidated_into_id, consolidated_at) values
      ('${canonicalId}', 'Colorado Events', null, null),
      ('${sourceA}', 'Handmade in Colorado Expo (Estes Park) CO', '${canonicalId}', now()),
      ('${sourceB}', 'Mile High Global Bazaar (Denver) CO', '${canonicalId}', now());

    insert into organization_locations (id, organization_id, label, city, region, consolidation_source_org_id) values
      ('${locationA}', '${canonicalId}', 'Estes Park, CO', 'Estes Park', 'CO', '${sourceA}'),
      ('${locationB}', '${canonicalId}', 'Denver, CO', 'Denver', 'CO', '${sourceB}'),
      ('${manualLocation}', '${canonicalId}', 'Manual location', 'Boulder', 'CO', null);

    insert into contacts (id, organization_id, organization_location_id, first_name, last_name) values
      ('${contactA}', '${canonicalId}', '${locationA}', 'A', 'Contact'),
      ('${contactB}', '${canonicalId}', '${locationB}', 'B', 'Contact');

    insert into organization_contacts (organization_id, contact_id, role, is_primary, active, source) values
      ('${canonicalId}', '${contactA}', 'Director', false, true, 'local'),
      ('${canonicalId}', '${contactB}', 'Coordinator', false, true, 'local');

    insert into bookings (id, organization_id, organization_location_id, name, city, region) values
      ('${bookingA}', '${canonicalId}', '${locationA}', 'Estes Park Expo', 'Estes Park', 'CO'),
      ('${bookingB}', '${canonicalId}', '${locationB}', 'Global Bazaar', 'Denver', 'CO');

    insert into activities (id, organization_id, organization_location_id, kind, body)
      values ('${activityA}', '${canonicalId}', '${locationA}', 'note', 'existing activity');
    insert into follow_ups (id, organization_id, organization_location_id, kind, due_at)
      values ('${followUpA}', '${canonicalId}', '${locationA}', 'call', now());
    insert into call_sessions (id, organization_id, organization_location_id)
      values ('${callA}', '${canonicalId}', '${locationA}');
    insert into scoped_notes (id, organization_location_id, body, created_at, updated_at)
      values ('${scopedNoteA}', '${locationA}', 'location-only note', '2026-08-20T10:00:00Z', '2026-08-20T10:00:00Z');
  `);
}

describe("profile location restoration", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("lists only locations that came from retired source profiles", async () => {
    const { client, db } = await createDatabase();
    clients.push(client);
    await seed(client);

    await expect(listRestorableProfileLocations(db as never, canonicalId)).resolves.toEqual([
      {
        locationId: locationB,
        sourceProfileId: sourceB,
        sourceProfileName: "Mile High Global Bazaar (Denver) CO",
        label: "Denver, CO",
        city: "Denver",
        region: "CO",
      },
      {
        locationId: locationA,
        sourceProfileId: sourceA,
        sourceProfileName: "Handmade in Colorado Expo (Estes Park) CO",
        label: "Estes Park, CO",
        city: "Estes Park",
        region: "CO",
      },
    ]);
  });

  it("reactivates every retired source profile and moves its location-owned CRM data back", async () => {
    const { client, db } = await createDatabase();
    clients.push(client);
    await seed(client);

    const result = await restoreAllProfileLocations(db as never, canonicalId, new Date("2026-08-21T16:00:00Z"));

    expect(result).toEqual({
      restoredLocationCount: 2,
      restoredProfileIds: [sourceA, sourceB],
    });

    const sourceRows = await client.query<{ id: string; consolidated_into_id: string | null }>(
      `select id, consolidated_into_id from organizations where id in ($1, $2) order by id`,
      [sourceA, sourceB],
    );
    expect(sourceRows.rows).toEqual([
      { id: sourceA, consolidated_into_id: null },
      { id: sourceB, consolidated_into_id: null },
    ]);

    expect((await client.query(`select organization_id, organization_location_id from contacts where id='${contactA}'`)).rows)
      .toEqual([{ organization_id: sourceA, organization_location_id: null }]);
    expect((await client.query(`select organization_id, organization_location_id from bookings where id='${bookingA}'`)).rows)
      .toEqual([{ organization_id: sourceA, organization_location_id: null }]);
    expect((await client.query(`select organization_id, organization_location_id from activities where id='${activityA}'`)).rows)
      .toEqual([{ organization_id: sourceA, organization_location_id: null }]);
    expect((await client.query(`select organization_id, organization_location_id from follow_ups where id='${followUpA}'`)).rows)
      .toEqual([{ organization_id: sourceA, organization_location_id: null }]);
    expect((await client.query(`select organization_id, organization_location_id from call_sessions where id='${callA}'`)).rows)
      .toEqual([{ organization_id: sourceA, organization_location_id: null }]);

    const memberships = await client.query<{ organization_id: string; contact_id: string; is_primary: boolean }>(
      `select organization_id, contact_id, is_primary from organization_contacts order by organization_id`,
    );
    expect(memberships.rows).toEqual([
      { organization_id: sourceA, contact_id: contactA, is_primary: true },
      { organization_id: sourceB, contact_id: contactB, is_primary: true },
    ]);

    const restoredNote = await client.query<{ organization_id: string; body: string }>(
      `select organization_id, body from activities where body = 'location-only note'`,
    );
    expect(restoredNote.rows).toEqual([{ organization_id: sourceA, body: "location-only note" }]);
    expect((await client.query(`select count(*)::int as count from scoped_notes`)).rows).toEqual([{ count: 0 }]);

    const remainingLocations = await client.query<{ id: string }>(`select id from organization_locations order by id`);
    expect(remainingLocations.rows).toEqual([{ id: manualLocation }]);
  });

  it("does not restore a location when its source profile is not retired into the selected parent", async () => {
    const { client, db } = await createDatabase();
    clients.push(client);
    await seed(client);
    await client.query(`update organizations set consolidated_into_id = null where id = $1`, [sourceB]);

    await expect(restoreAllProfileLocations(db as never, canonicalId, new Date()))
      .rejects.toThrow(/restore safely/i);

    expect((await client.query(`select count(*)::int as count from organization_locations`)).rows)
      .toEqual([{ count: 3 }]);
  });
});
