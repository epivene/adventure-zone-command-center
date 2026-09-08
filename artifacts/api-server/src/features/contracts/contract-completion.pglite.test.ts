import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ContractLifecycleService, DrizzleContractLifecycleRepository } from "./contract-lifecycle-service";

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.close())); });

async function setup() {
  const client = new PGlite();
  databases.push(client);
  await client.exec(`
    create type booking_status as enum ('new_lead','researching','contact_due','contacted','interested','possible','unlikely','quote_sent','pending_decision','pending_contract','contract_received','confirmed','declined','cancelled','completed','renewal_due');
    create type activity_kind as enum ('call','note','follow_up','status_change','booking_update','contract_update','calendar','act_history','approved_suggestion');
    create table organizations (id uuid primary key);
    create table bookings (id uuid primary key, organization_id uuid references organizations(id), name text not null default '', city text not null default '', region text not null default '', status booking_status not null default 'new_lead', updated_at timestamptz not null default now());
    create table activities (id uuid primary key default gen_random_uuid(), organization_id uuid, contact_id uuid, booking_id uuid, kind activity_kind not null, subject text, status text, body text not null, occurred_at timestamptz, timeline_sort_at timestamptz not null, date_is_import_fallback boolean not null default false, ends_at timestamptz, act_record_id text, source_record_id uuid, source_version_id uuid, source_type text, organization_location_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
    create table audit_entries (id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null, action text not null, before jsonb, after jsonb, reverses_entry_id uuid, created_at timestamptz not null default now());
  `);
  const migration = await readFile(fileURLToPath(new URL("../../../../../lib/db/migrations/20260908_contract_builder.sql", import.meta.url)), "utf8");
  await client.exec(migration);
  await client.exec(`
    insert into organizations values ('11111111-1111-4111-8111-111111111111');
    insert into bookings (id, organization_id, status) values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','pending_contract');
    insert into contract_templates (id, stable_key, version, state, created_by) values ('33333333-3333-4333-8333-333333333333','adventure-zone-standard',1,'active','owner');
    insert into contract_drafts (id, booking_id, organization_id, template_id, last_edited_by, finalized_at) values ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','owner',now());
    insert into contract_versions (id, booking_id, organization_id, template_id, draft_id, version_number, status, snapshot, rendered_legal_text, signer_snapshot, created_by) values ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',1,'sent_for_signature','{}','agreement','[]','owner');
    insert into contract_files (id, contract_version_id, kind, revision, storage_key, original_filename, original_size_bytes, sha256_hex, uploaded_by) values
      ('66666666-6666-4666-8666-666666666666','55555555-5555-4555-8555-555555555555','signed_completed',1,'one','one.pdf',10,repeat('a',64),'owner'),
      ('77777777-7777-4777-8777-777777777777','55555555-5555-4555-8555-555555555555','signed_completed',2,'two','two.pdf',10,repeat('b',64),'owner');
  `);
  return { client, service: new ContractLifecycleService(new DrizzleContractLifecycleRepository(drizzle(client) as never), () => new Date("2026-09-08T19:00:00Z")) };
}

describe("signed contract completion", () => {
  it("confirms only the selected revision and commits completion once", async () => {
    const { client, service } = await setup();
    const input = { contractVersionId: "55555555-5555-4555-8555-555555555555", fileId: "77777777-7777-4777-8777-777777777777", actorId: "owner" };
    const first = await service.confirmSignedFile(input);
    const retry = await service.confirmSignedFile(input);
    expect(first.reused).toBe(false);
    expect(retry.reused).toBe(true);
    const state = await client.query<{ status: string }>("select status::text from contract_versions");
    expect(state.rows[0]?.status).toBe("completed");
    const booking = await client.query<{ status: string }>("select status::text from bookings");
    expect(booking.rows[0]?.status).toBe("contract_received");
    const files = await client.query<{ id: string; confirmed: boolean }>("select id::text, confirmed_at is not null as confirmed from contract_files order by revision");
    expect(files.rows).toEqual([
      { id: "66666666-6666-4666-8666-666666666666", confirmed: false },
      { id: "77777777-7777-4777-8777-777777777777", confirmed: true },
    ]);
    for (const table of ["contract_status_events", "activities", "audit_entries"]) {
      const count = await client.query<{ count: number }>(`select count(*)::int as count from ${table}`);
      expect(count.rows[0]?.count).toBe(1);
    }
  });
});
