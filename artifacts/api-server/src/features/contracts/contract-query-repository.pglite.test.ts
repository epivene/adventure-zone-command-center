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
});
