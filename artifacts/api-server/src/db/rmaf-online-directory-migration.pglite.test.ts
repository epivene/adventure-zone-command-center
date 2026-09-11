import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("20260910 RMAF online directory migration", () => {
  it("executes the complete 285-record directory import", async () => {
    const sql = await readFile(
      new URL("../../../../lib/db/migrations/20260910_rmaf_online_directory.sql", import.meta.url),
      "utf8",
    );
    const client = new PGlite();

    try {
      await client.exec(`
        create table organizations (
          id uuid primary key default gen_random_uuid(), name text not null, place_type text,
          address_1 text, city text, region text, postal_code text, website text, phone text,
          normalized_phone text, consolidated_into_id uuid
        );
        create table contacts (
          id uuid primary key default gen_random_uuid(), first_name text, last_name text,
          email text, phone text, normalized_phone text, organization_id uuid
        );
        create table organization_contacts (
          organization_id uuid, contact_id uuid, role text, is_primary boolean,
          active boolean, source text, primary key (organization_id, contact_id)
        );
        create table activities (
          organization_id uuid, contact_id uuid, kind text, subject text, body text,
          occurred_at timestamptz, timeline_sort_at timestamptz, source_type text
        );
        create table convention_editions (
          id uuid primary key default gen_random_uuid(), convention text, year integer,
          archived_at timestamptz, revision integer not null default 0
        );
        create table convention_members (
          id uuid primary key default gen_random_uuid(), edition_id uuid, source_key text,
          organization_id uuid, contact_id uuid, data jsonb not null default '{}'::jsonb,
          revision integer not null default 0, updated_at timestamptz not null default now()
        );
        create table convention_history (
          edition_id uuid, member_id uuid, kind text, actor text, mutation_key text, payload jsonb
        );
        insert into convention_editions (convention, year) values
          ('Arizona AFA', 2026), ('Colorado', 2026), ('Heartland', 2026),
          ('RMAF', 2026), ('Wyoming', 2026);
      `);

      await client.exec(sql);

      const imported = await client.query<{ count: number }>(
        "select count(*)::integer as count from directory_import_records",
      );
      const cards = await client.query<{ count: number }>(`
        select count(*)::integer as count
        from convention_members m
        join convention_editions e on e.id = m.edition_id
        where e.convention = 'RMAF' and e.year = 2026
      `);
      expect(imported.rows[0]?.count).toBe(285);
      expect(cards.rows[0]?.count).toBe(284);
    } finally {
      await client.close();
    }
  }, 20_000);
});
