import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../../lib/db/migrations/074_profile_appearance_integrity.sql",
  import.meta.url,
);

const pirateProfileId = "f24033e1-801b-43ff-9a7e-a9d6d7b426c3";
const pirateAppearanceId = "cd7ce3ca-7370-47a3-9f07-0ca617e03695";
const pirateSourceAppearanceId = "10000000-0000-4000-8000-000000000001";
const piratePrimaryContactId = "20000000-0000-4000-8000-000000000001";
const pirateDuplicateContactId = "20000000-0000-4000-8000-000000000002";
const moabProfileId = "dd318274-33b8-4331-9901-766d8a6ae4aa";
const moabAppearanceId = "da5e9218-c183-4e98-995c-00758242e9c3";
const moabSourceAppearanceId = "30000000-0000-4000-8000-000000000001";
const southernProfileId = "2aea58c4-3d36-4de1-b908-7f8d6e15ad99";
const southernHistoricalAppearanceId = "4cb427f6-9dfe-4613-a7a3-36a25ad852c4";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create extension if not exists pgcrypto;

    create table organizations (
      id uuid primary key,
      name text not null,
      city text,
      region text,
      consolidated_into_id uuid,
      act_record_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table contacts (
      id uuid primary key,
      first_name text not null,
      last_name text not null,
      email text,
      phone text,
      normalized_phone text,
      act_record_id text,
      job_title text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table organization_contacts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id),
      contact_id uuid not null references contacts(id),
      role text,
      is_primary boolean not null default false,
      active boolean not null default true,
      source text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (organization_id, contact_id)
    );

    create table bookings (
      id uuid primary key,
      organization_id uuid references organizations(id),
      primary_contact_id uuid references contacts(id),
      name text not null,
      city text not null default '',
      region text not null default '',
      address_1 text,
      postal_code text,
      starts_at timestamptz,
      ends_at timestamptz,
      status text not null,
      probability text not null,
      travel_leg_id uuid,
      notes text,
      act_record_id text,
      next_action_kind text,
      next_action_due_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table booking_consolidations (
      source_booking_id uuid primary key references bookings(id),
      canonical_booking_id uuid not null references bookings(id),
      original_status text not null,
      original_probability text not null,
      original_travel_leg_id uuid,
      original_starts_at timestamptz,
      original_ends_at timestamptz,
      consolidated_at timestamptz not null default now()
    );

    create table booking_contacts (
      id uuid primary key default gen_random_uuid(),
      booking_id uuid not null references bookings(id),
      contact_id uuid not null references contacts(id),
      role text,
      is_primary boolean not null default false,
      source text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (booking_id, contact_id)
    );

    create table follow_ups (
      id uuid primary key default gen_random_uuid(),
      booking_id uuid references bookings(id),
      organization_id uuid references organizations(id),
      contact_id uuid references contacts(id),
      kind text not null,
      due_at timestamptz not null,
      completed_at timestamptz,
      outcome text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    -- Deliberately has no updated_at column. The migration must respect the real schema.
    create table call_sessions (
      id uuid primary key default gen_random_uuid(),
      contact_id uuid references contacts(id),
      booking_id uuid references bookings(id)
    );

    create table google_workspace_validation_mappings (
      id uuid primary key default gen_random_uuid(),
      contact_id uuid references contacts(id),
      updated_at timestamptz not null default now()
    );

    create table google_operational_calendar_links (
      id uuid primary key default gen_random_uuid(),
      connection_id uuid not null,
      calendar_id text not null,
      google_event_id text not null,
      package_key text not null,
      booking_id uuid not null references bookings(id),
      updated_at timestamptz not null default now(),
      unique (connection_id, calendar_id, google_event_id, package_key, booking_id)
    );

    create table google_operational_calendar_reviews (
      id uuid primary key default gen_random_uuid(),
      booking_id uuid references bookings(id),
      updated_at timestamptz not null default now()
    );

    create table activities (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid references organizations(id),
      booking_id uuid references bookings(id),
      kind text not null,
      subject text,
      body text not null,
      occurred_at timestamptz,
      timeline_sort_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table audit_entries (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id uuid not null,
      action text not null,
      before jsonb,
      after jsonb,
      created_at timestamptz not null default now()
    );
  `);
  return client;
}

async function seed(client: PGlite) {
  await client.exec(`
    insert into organizations (id, name, city, region, act_record_id) values
      ('${pirateProfileId}', 'Pirate Fest, The (Northglenn) CO', 'Northglenn', 'CO', 'ACT-PIRATE'),
      ('${moabProfileId}', 'Moab Music Festival', 'Moab', 'UT', 'ACT-MOAB'),
      ('${southernProfileId}', 'Southern Ute Tribal Fair', 'Ignacio', 'CO', 'ACT-SOUTHERN');

    insert into contacts (
      id, first_name, last_name, email, phone, normalized_phone, act_record_id, created_at, updated_at
    ) values
      ('${piratePrimaryContactId}', 'Michael', 'Ringling', 'mringling@northglenn.org', '720-955-3603', '7209553603', null, '2026-08-28T00:00:00Z', '2026-08-30T00:00:00Z'),
      ('${pirateDuplicateContactId}', 'Michael', 'Ringling', 'mringling@northglenn.org', '303-450-8935', '3034508935', 'ACT-MICHAEL', '2020-01-01T00:00:00Z', '2026-08-20T00:00:00Z');

    insert into organization_contacts (organization_id, contact_id, role, is_primary, active, source) values
      ('${pirateProfileId}', '${piratePrimaryContactId}', 'Events Specialist', true, true, 'local'),
      ('${pirateProfileId}', '${pirateDuplicateContactId}', 'Events Specialist', false, true, 'act');

    insert into bookings (
      id, organization_id, primary_contact_id, name, city, region, starts_at, ends_at,
      status, probability, notes, next_action_kind, next_action_due_at, updated_at
    ) values
      ('${pirateAppearanceId}', '${pirateProfileId}', '${piratePrimaryContactId}', 'Pirate Fest - 2026', 'Northglenn', 'CO', '2026-09-18T12:00:00Z', '2026-09-19T12:00:00Z', 'pending_decision', 'possible', null, 'follow_up', '2026-08-28T15:00:00Z', '2026-08-30T00:00:00Z'),
      ('${pirateSourceAppearanceId}', '${pirateProfileId}', '${pirateDuplicateContactId}', 'Pirate Fest - 2026 duplicate', 'Northglenn', 'CO', null, null, 'completed', 'unlikely', '[Merged duplicate] Canonical booking: ${pirateAppearanceId}', null, null, '2026-08-20T00:00:00Z'),
      ('${moabAppearanceId}', '${moabProfileId}', null, 'Moab Music Festival - 2026', 'Moab', 'UT', '2026-09-07T12:00:00Z', '2026-09-07T12:00:00Z', 'contacted', 'possible', null, 'follow_up', '2026-09-01T15:00:00Z', '2026-08-30T00:00:00Z'),
      ('${moabSourceAppearanceId}', '${moabProfileId}', null, 'Moab Music Festival duplicate', 'Moab', 'UT', null, null, 'completed', 'unlikely', '[Merged duplicate] Canonical booking: ${moabAppearanceId}', null, null, '2026-08-20T00:00:00Z'),
      ('${southernHistoricalAppearanceId}', '${southernProfileId}', null, 'Southern Ute Tribal Fair - 2013', 'Ignacio', 'CO', '2013-09-11T12:00:00Z', '2013-09-13T12:00:00Z', 'cancelled', 'unlikely', '2026 event dates Sept 11-13. Invoice sent May 13, 2026 for $15,000 with $3,000 deposit; contract and deposit pending.', null, null, '2026-08-30T00:00:00Z');

    insert into booking_contacts (booking_id, contact_id, role, is_primary, source) values
      ('${pirateAppearanceId}', '${piratePrimaryContactId}', 'Events Specialist', true, 'local'),
      ('${pirateSourceAppearanceId}', '${pirateDuplicateContactId}', 'Events Specialist', true, 'act');

    insert into follow_ups (booking_id, organization_id, contact_id, kind, due_at, outcome) values
      (null, '${pirateProfileId}', null, 'Call Michael about current Pirate contract', '2026-08-28T15:00:00Z', 'stale'),
      ('${pirateAppearanceId}', null, null, 'Pirate contract follow-up', '2026-08-28T15:00:00Z', 'stale'),
      ('${pirateSourceAppearanceId}', null, null, 'Duplicate Pirate task', '2026-08-28T15:00:00Z', 'stale'),
      (null, '${moabProfileId}', null, 'Moab next action', '2026-09-01T15:00:00Z', null),
      ('${moabAppearanceId}', null, null, 'Duplicate Moab next action', '2026-09-01T15:00:00Z', null);

    insert into call_sessions (contact_id, booking_id)
    values ('${pirateDuplicateContactId}', '${pirateSourceAppearanceId}');

    insert into google_workspace_validation_mappings (contact_id)
    values ('${pirateDuplicateContactId}');
  `);
}

describe("074 profile appearance integrity migration", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("keeps source rows for provenance while exposing one canonical appearance, contact, and next action", async () => {
    const client = await createDatabase();
    clients.push(client);
    await seed(client);

    const migration = await readFile(migrationUrl, "utf8");
    await client.exec(migration);

    expect((await client.query(`
      select source_booking_id, canonical_booking_id
        from booking_consolidations
       where source_booking_id = '${pirateSourceAppearanceId}'
    `)).rows).toEqual([{
      source_booking_id: pirateSourceAppearanceId,
      canonical_booking_id: pirateAppearanceId,
    }]);

    expect((await client.query(`
      select source_contact_id, canonical_contact_id
        from contact_consolidations
       where source_contact_id = '${pirateDuplicateContactId}'
    `)).rows).toEqual([{
      source_contact_id: pirateDuplicateContactId,
      canonical_contact_id: piratePrimaryContactId,
    }]);

    expect((await client.query(`
      select active, is_primary
        from organization_contacts
       where organization_id = '${pirateProfileId}'
         and contact_id = '${pirateDuplicateContactId}'
    `)).rows).toEqual([{ active: false, is_primary: false }]);

    expect((await client.query(`
      select status, probability, next_action_kind, next_action_due_at
        from bookings where id = '${pirateAppearanceId}'
    `)).rows).toEqual([{
      status: "confirmed",
      probability: "likely",
      next_action_kind: "renewal",
      next_action_due_at: new Date("2027-01-15T15:00:00.000Z"),
    }]);

    const pirateOpen = (await client.query(`
      select organization_id, booking_id, contact_id, kind, due_at
        from follow_ups
       where completed_at is null
         and (
           organization_id = '${pirateProfileId}'
           or booking_id in (
             select id from bookings where organization_id = '${pirateProfileId}'
           )
         )
    `)).rows;
    expect(pirateOpen).toEqual([{
      organization_id: pirateProfileId,
      booking_id: null,
      contact_id: null,
      kind: "Renew Pirate Fest with Michael Ringling for 2027",
      due_at: new Date("2027-01-15T15:00:00.000Z"),
    }]);

    expect((await client.query("select contact_id, booking_id from call_sessions")).rows).toEqual([{
      contact_id: piratePrimaryContactId,
      booking_id: pirateAppearanceId,
    }]);
    expect((await client.query("select contact_id from google_workspace_validation_mappings")).rows).toEqual([{
      contact_id: piratePrimaryContactId,
    }]);

    expect((await client.query(`
      select count(*)::int as count
        from follow_ups f
       where f.completed_at is null
         and (
           f.organization_id = '${moabProfileId}'
           or f.booking_id in (select id from bookings where organization_id = '${moabProfileId}')
         )
    `)).rows).toEqual([{ count: 1 }]);
  });

  it("preserves the cancelled 2013 Southern Ute appearance and creates one pending-contract 2026 appearance", async () => {
    const client = await createDatabase();
    clients.push(client);
    await seed(client);

    const migration = await readFile(migrationUrl, "utf8");
    await client.exec(migration);

    expect((await client.query(`
      select status, starts_at, ends_at
        from bookings where id = '${southernHistoricalAppearanceId}'
    `)).rows).toEqual([{
      status: "cancelled",
      starts_at: new Date("2013-09-11T12:00:00.000Z"),
      ends_at: new Date("2013-09-13T12:00:00.000Z"),
    }]);

    expect((await client.query(`
      select name, status, probability, starts_at, ends_at
        from bookings
       where organization_id = '${southernProfileId}'
         and starts_at::date = '2026-09-11'::date
    `)).rows).toEqual([{
      name: "Southern Ute Tribal Fair - 2026",
      status: "pending_contract",
      probability: "likely",
      starts_at: new Date("2026-09-11T12:00:00.000Z"),
      ends_at: new Date("2026-09-13T12:00:00.000Z"),
    }]);

    expect((await client.query(`
      select subject, occurred_at
        from activities
       where organization_id = '${southernProfileId}'
         and subject = 'Southern Ute Tribal Fair 2026 invoice / contract pending'
    `)).rows).toEqual([{
      subject: "Southern Ute Tribal Fair 2026 invoice / contract pending",
      occurred_at: new Date("2026-05-13T15:00:00.000Z"),
    }]);
  });
});
