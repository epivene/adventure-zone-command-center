import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { DrizzleContractQueryRepository } from "./contract-query-repository";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("DrizzleContractQueryRepository", () => {
  it("includes the booking start date in workspace contract records", async () => {
    const client = new PGlite();
    databases.push(client);
    await client.exec(`
      create table organizations (id uuid primary key, name text not null);
      create table bookings (
        id uuid primary key,
        organization_id uuid not null references organizations(id),
        name text not null,
        starts_at timestamptz,
        status text not null,
        notes text
      );
    `);
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/20260908_contract_builder.sql", import.meta.url)),
      "utf8",
    );
    await client.exec(migration);
    await client.exec(`
      insert into organizations values ('11111111-1111-4111-8111-111111111111', 'Fairplay Burro Days');
      insert into bookings (id, organization_id, name, starts_at, status, notes)
      values (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'Fairplay Burro Days',
        '2027-07-23T16:00:00Z',
        'confirmed',
        null
      );
      insert into contract_templates (id, stable_key, version, state, created_by)
      values ('33333333-3333-4333-8333-333333333333', 'adventure-zone-standard', 1, 'active', 'owner');
      insert into contract_drafts (
        id, booking_id, organization_id, template_id, values, validation_state, last_edited_by, finalized_at
      ) values (
        '44444444-4444-4444-8444-444444444444',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
        '{}'::jsonb,
        '{"ready":true,"errors":[],"warnings":[]}'::jsonb,
        'owner',
        now()
      );
      insert into contract_versions (
        id, booking_id, organization_id, template_id, draft_id, version_number,
        status, snapshot, rendered_legal_text, signer_snapshot, created_by
      ) values (
        '55555555-5555-4555-8555-555555555555',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        1,
        'completed',
        '{}'::jsonb,
        'Contract',
        '{}'::jsonb,
        'owner'
      );
    `);

    const [contract] = await new DrizzleContractQueryRepository(drizzle(client) as never)
      .listWorkspaceContracts();

    expect(contract).toMatchObject({
      organizationName: "Fairplay Burro Days",
      bookingName: "Fairplay Burro Days",
      bookingStartsAt: new Date("2027-07-23T16:00:00.000Z"),
    });
  });

  it("excludes bookings retired into a canonical booking from contract choices", async () => {
    const client = new PGlite();
    databases.push(client);
    await client.exec(`
      create table organizations (id uuid primary key);
      create table bookings (
        id uuid primary key,
        organization_id uuid not null references organizations(id),
        name text not null,
        starts_at timestamptz,
        status text not null,
        notes text
      );
    `);
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/20260908_contract_builder.sql", import.meta.url)),
      "utf8",
    );
    await client.exec(migration);
    await client.exec(`
      insert into organizations values ('11111111-1111-4111-8111-111111111111');
      insert into bookings (id, organization_id, name, starts_at, status, notes) values
        ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Pirate Fest - 2026', '2026-09-18T17:00:00Z', 'pending_decision', null),
        ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Pirate Fest - 2026', null, 'completed', 'Historical note. [Merged duplicate] Canonical booking: 22222222-2222-4222-8222-222222222222'),
        ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'Northglenn July 4 Celebration - 2026', '2026-07-04T17:00:00Z', 'interested', null);
    `);

    const result = await new DrizzleContractQueryRepository(drizzle(client) as never)
      .listOrganization("11111111-1111-4111-8111-111111111111");

    expect(result.eligibleBookings.map(({ id }) => id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "44444444-4444-4444-8444-444444444444",
    ]);
  });

  it("returns a draft in the contract API shape consumed by the builder", async () => {
    const client = new PGlite();
    databases.push(client);
    await client.exec(`
      create table organizations (id uuid primary key);
      create table bookings (id uuid primary key, organization_id uuid references organizations(id));
    `);
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/20260908_contract_builder.sql", import.meta.url)),
      "utf8",
    );
    await client.exec(migration);
    await client.exec(`
      insert into organizations values ('11111111-1111-4111-8111-111111111111');
      insert into bookings values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
      insert into contract_templates (id, stable_key, version, state, created_by)
      values ('33333333-3333-4333-8333-333333333333', 'adventure-zone-standard', 1, 'active', 'owner');
      insert into contract_drafts (
        id, booking_id, organization_id, template_id, values, validation_state, last_edited_by
      ) values (
        '44444444-4444-4444-8444-444444444444',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
        '{"contract":{"eventName":"Moab Music Festival"}}'::jsonb,
        '{"ready":false,"errors":[],"warnings":[]}'::jsonb,
        'owner'
      );
    `);

    const draft = await new DrizzleContractQueryRepository(drizzle(client) as never)
      .getDraft("44444444-4444-4444-8444-444444444444");

    expect(draft).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      templateVersion: 1,
      storedValues: { contract: { eventName: "Moab Music Festival" } },
      validationState: { ready: false, errors: [], warnings: [] },
    });
    expect(draft).not.toHaveProperty("values");
  });
});
