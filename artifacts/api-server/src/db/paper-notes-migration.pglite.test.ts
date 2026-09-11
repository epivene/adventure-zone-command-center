import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

async function hasTable(client: PGlite, name: string) {
  const result = await client.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [name],
  );
  return result.rows[0]?.present ?? false;
}

async function hasColumn(client: PGlite, table: string, column: string) {
  const result = await client.query<{ present: boolean }>(`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = $1
        and column_name = $2
    ) as present
  `, [table, column]);
  return result.rows[0]?.present ?? false;
}

async function createLegacyDatabase() {
  const client = new PGlite();
  await client.exec(`
    create extension if not exists pgcrypto;

    create type contact_phone_type as enum ('mobile', 'office', 'alternate', 'unknown');

    create table organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      phone text,
      normalized_phone text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table organization_locations (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id),
      label text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (organization_id, id)
    );

    create table contacts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid references organizations(id),
      first_name text not null,
      last_name text not null,
      phone text,
      normalized_phone text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table contact_phones (
      id uuid primary key default gen_random_uuid(),
      contact_id uuid not null references contacts(id) on delete cascade,
      number text not null,
      normalized_number text,
      type contact_phone_type not null default 'unknown',
      extension text,
      label text,
      primary boolean not null default false,
      source text not null default 'local',
      do_not_call_at timestamptz,
      do_not_call_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table event_families (
      id uuid primary key default gen_random_uuid(),
      name text not null
    );

    create table follow_ups (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid references organizations(id),
      contact_id uuid references contacts(id),
      kind text not null,
      due_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table activities (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid references organizations(id),
      contact_id uuid references contacts(id),
      booking_id uuid,
      kind text not null,
      subject text,
      status text,
      body text not null,
      occurred_at timestamptz,
      timeline_sort_at timestamptz not null,
      date_is_import_fallback boolean not null default false,
      source_record_id uuid,
      source_version_id uuid,
      source_type text,
      organization_location_id uuid references organization_locations(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz,
      constraint activities_parent_required check (
        organization_id is not null or contact_id is not null or booking_id is not null or source_record_id is not null
      ),
      constraint activities_occurred_at_required_for_local check (
        occurred_at is not null or source_record_id is not null
      ),
      constraint activities_source_type_valid check (
        source_type is null or source_type in ('note', 'history', 'activity')
      )
    );
  `);
  return client;
}

async function runMigration(client: PGlite) {
  const sql = await readFile(
    new URL("../../../../lib/db/migrations/066_paper_notes_importer.sql", import.meta.url),
    "utf8",
  );
  await client.exec(sql);
}

describe("066_paper_notes_importer migration", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("adds durable paper-note tables and provenance columns", async () => {
    const client = await createLegacyDatabase();
    clients.push(client);

    await runMigration(client);

    expect(await hasTable(client, "paper_note_batches")).toBe(true);
    expect(await hasTable(client, "paper_note_pages")).toBe(true);
    expect(await hasTable(client, "paper_note_entries")).toBe(true);
    expect(await hasTable(client, "organization_phones")).toBe(true);
    expect(await hasColumn(client, "activities", "paper_note_entry_id")).toBe(true);
    expect(await hasColumn(client, "contact_phones", "instructions")).toBe(true);
    expect(await hasColumn(client, "contact_phones", "status")).toBe(true);
    expect(await hasColumn(client, "contact_phones", "source_paper_note_entry_id")).toBe(true);
  });

  it("backfills the legacy organization phone exactly once without replacing it", async () => {
    const client = await createLegacyDatabase();
    clients.push(client);
    const organizationId = "10000000-0000-4000-8000-000000000001";
    await client.query(`
      insert into organizations (id, name, phone, normalized_phone)
      values ($1, 'Fictional County Fair', '(701) 555-0100', '7015550100')
    `, [organizationId]);

    await runMigration(client);
    await runMigration(client);

    expect((await client.query(`
      select phone, normalized_phone from organizations where id = $1
    `, [organizationId])).rows).toEqual([
      { phone: "(701) 555-0100", normalized_phone: "7015550100" },
    ]);
    expect((await client.query(`
      select organization_id, number, normalized_number, status, primary, source
      from organization_phones
      where organization_id = $1
    `, [organizationId])).rows).toEqual([
      {
        organization_id: organizationId,
        number: "(701) 555-0100",
        normalized_number: "7015550100",
        status: "active",
        primary: true,
        source: "legacy_backfill",
      },
    ]);
  });

  it("keeps an existing active primary when backfilling a different legacy number", async () => {
    const client = await createLegacyDatabase();
    clients.push(client);
    await runMigration(client);

    const organizationId = "10000000-0000-4000-8000-000000000003";
    await client.query(`
      insert into organizations (id, name, phone, normalized_phone)
      values ($1, 'Existing Primary Fair', '(701) 555-0200', '7015550200')
    `, [organizationId]);
    await client.query(`
      insert into organization_phones (
        organization_id, number, normalized_number, type, status, "primary", source
      ) values ($1, '(701) 555-0100', '7015550100', 'office', 'active', true, 'local')
    `, [organizationId]);

    await runMigration(client);

    expect((await client.query(`
      select normalized_number, "primary" as is_primary
      from organization_phones
      where organization_id = $1
      order by normalized_number
    `, [organizationId])).rows).toEqual([
      { normalized_number: "7015550100", is_primary: true },
      { normalized_number: "7015550200", is_primary: false },
    ]);
  });

  it("allows an unknown historical date only for a paper-note-backed activity", async () => {
    const client = await createLegacyDatabase();
    clients.push(client);
    await runMigration(client);

    const organizationId = "10000000-0000-4000-8000-000000000002";
    const batchId = "20000000-0000-4000-8000-000000000002";
    const pageId = "30000000-0000-4000-8000-000000000002";
    const entryId = "40000000-0000-4000-8000-000000000002";
    await client.query("insert into organizations (id, name) values ($1, 'Example Festival')", [organizationId]);
    await client.query("insert into paper_note_batches (id, status) values ($1, 'review')", [batchId]);
    await client.query(`
      insert into paper_note_pages (
        id, batch_id, sort_order, original_filename, mime_type, size_bytes,
        rotation_degrees, original_object_key, sha256, status
      ) values ($1, $2, 0, 'page.jpg', 'image/jpeg', 123, 0, 'paper-notes/example/original', 'abc', 'extracted')
    `, [pageId, batchId]);
    await client.query(`
      insert into paper_note_entries (id, batch_id, page_id, source_order, extraction_payload, review_payload, state)
      values ($1, $2, $3, 0, '{}'::jsonb, '{}'::jsonb, 'approved')
    `, [entryId, batchId, pageId]);

    await expect(client.query(`
      insert into activities (
        organization_id, kind, body, occurred_at, timeline_sort_at,
        date_is_import_fallback, source_type, paper_note_entry_id
      ) values ($1, 'note', 'Imported from paper notes', null, now(), true, 'paper_note', $2)
    `, [organizationId, entryId])).resolves.toBeDefined();

    await expect(client.query(`
      insert into activities (
        organization_id, kind, body, occurred_at, timeline_sort_at,
        date_is_import_fallback, source_type
      ) values ($1, 'note', 'ordinary local note', null, now(), true, null)
    `, [organizationId])).rejects.toThrow();
  });
});
