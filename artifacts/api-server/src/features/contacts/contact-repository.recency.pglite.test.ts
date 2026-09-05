import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DrizzleContactRepository } from "./contact-repository";

const olderContactId = "11111111-1111-4111-8111-111111111111";
const recentContactId = "22222222-2222-4222-8222-222222222222";

let client: PGlite;
let repository: DrizzleContactRepository;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null,
      last_resort boolean not null default false,
      last_resort_reason text
    );
    create table contacts (
      id uuid primary key,
      organization_id uuid,
      first_name text not null,
      last_name text not null,
      email text,
      phone text,
      normalized_phone text,
      quick_add_request_key uuid,
      job_title text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      act_record_id text,
      organization_location_id uuid,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table contact_consolidations (
      source_contact_id uuid primary key
    );
    create table act_contact_sync_states (
      contact_id uuid primary key,
      state text,
      last_synced_at timestamptz
    );
    create table activities (
      id uuid primary key,
      contact_id uuid,
      timeline_sort_at timestamptz not null,
      deleted_at timestamptz
    );

    insert into contacts (
      id, first_name, last_name, created_at, updated_at
    ) values
      ('${olderContactId}', 'Avery', 'Alpha', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('${recentContactId}', 'Zoe', 'Zulu', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    insert into activities (id, contact_id, timeline_sort_at) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${olderContactId}', '2026-08-01T00:00:00Z'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${recentContactId}', '2026-09-04T00:00:00Z');
  `);
  repository = new DrizzleContactRepository(drizzle(client) as never);
});

afterAll(async () => {
  await client.close();
});

describe("contact directory recency", () => {
  it("puts the contact with the newest activity first", async () => {
    const page = await repository.listContacts({
      search: "",
      state: "all",
      page: 1,
      pageSize: 50,
    });

    expect(page.records.map(({ id }) => id)).toEqual([
      recentContactId,
      olderContactId,
    ]);
  });
});
