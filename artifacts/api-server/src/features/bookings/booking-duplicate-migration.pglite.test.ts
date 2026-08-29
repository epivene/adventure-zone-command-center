import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../../../lib/db/migrations/20260828_booking_duplicate_consolidation.sql",
  import.meta.url,
);

const canonicalId = "30000000-0000-4000-8000-000000000001";
const duplicateId = "30000000-0000-4000-8000-000000000002";
const differentDateId = "30000000-0000-4000-8000-000000000003";
const canonicalFollowUpId = "40000000-0000-4000-8000-000000000001";
const duplicateFollowUpId = "40000000-0000-4000-8000-000000000002";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table bookings (
      id uuid primary key,
      name text not null,
      city text not null,
      region text not null,
      starts_at timestamptz,
      ends_at timestamptz,
      status text not null,
      probability text not null,
      travel_leg_id uuid,
      notes text,
      updated_at timestamptz not null default now()
    );

    create table follow_ups (
      id uuid primary key,
      booking_id uuid references bookings(id),
      kind text not null,
      due_at timestamptz not null,
      completed_at timestamptz,
      outcome text,
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

async function seedDuplicates(client: PGlite) {
  await client.exec(`
    insert into bookings (id, name, city, region, starts_at, ends_at, status, probability, travel_leg_id, updated_at)
    values
      ('${canonicalId}', 'Twin Falls County Fair - 2026', 'Filer', 'ID', '2026-09-02T12:00:00Z', '2026-09-07T20:00:00Z', 'contacted', 'possible', '10000000-0000-4000-8000-000000000001', '2026-08-28T15:00:00Z'),
      ('${duplicateId}', '  twin   falls county fair - 2026 ', 'FILER', 'id', '2026-09-02T14:00:00Z', '2026-09-07T18:00:00Z', 'new_lead', 'possible', null, '2026-08-20T15:00:00Z'),
      ('${differentDateId}', 'Twin Falls County Fair - 2026', 'Filer', 'ID', '2026-09-08T12:00:00Z', '2026-09-08T20:00:00Z', 'new_lead', 'possible', null, '2026-08-20T15:00:00Z');

    insert into follow_ups (id, booking_id, kind, due_at, completed_at, outcome, created_at)
    values
      ('${canonicalFollowUpId}', '${canonicalId}', 'call', '2026-08-29T15:00:00Z', null, null, '2026-08-20T15:00:00Z'),
      ('${duplicateFollowUpId}', '${duplicateId}', 'email', '2026-08-28T15:00:00Z', null, null, '2026-08-19T15:00:00Z');
  `);
}

describe("20260828 booking duplicate consolidation migration", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("retires only exact same-event/date duplicates and leaves one active follow-up on the canonical booking", async () => {
    const client = await createDatabase();
    clients.push(client);
    await seedDuplicates(client);

    const migration = await readFile(migrationUrl, "utf8");
    await client.exec(migration);

    const consolidations = (
      await client.query(`
        select source_booking_id, canonical_booking_id, original_starts_at, original_ends_at
        from booking_consolidations
        order by source_booking_id
      `)
    ).rows;
    expect(consolidations).toEqual([
      {
        source_booking_id: duplicateId,
        canonical_booking_id: canonicalId,
        original_starts_at: new Date("2026-09-02T14:00:00.000Z"),
        original_ends_at: new Date("2026-09-07T18:00:00.000Z"),
      },
    ]);

    const retired = (
      await client.query(
        "select status, probability, travel_leg_id, starts_at, ends_at, notes from bookings where id = $1",
        [duplicateId],
      )
    ).rows[0];
    expect(retired).toMatchObject({
      status: "completed",
      probability: "unlikely",
      travel_leg_id: null,
      starts_at: null,
      ends_at: null,
    });
    expect(String((retired as any).notes)).toContain(canonicalId);

    expect(
      (
        await client.query(
          "select id, starts_at from bookings where id = $1",
          [differentDateId],
        )
      ).rows,
    ).toEqual([
      { id: differentDateId, starts_at: new Date("2026-09-08T12:00:00.000Z") },
    ]);

    const openFollowUps = (
      await client.query(`
        select id, booking_id, kind
        from follow_ups
        where completed_at is null
        order by id
      `)
    ).rows;
    expect(openFollowUps).toEqual([
      { id: canonicalFollowUpId, booking_id: canonicalId, kind: "call" },
    ]);

    expect(
      (
        await client.query(
          "select completed_at is not null as completed, outcome from follow_ups where id = $1",
          [duplicateFollowUpId],
        )
      ).rows,
    ).toEqual([
      { completed: true, outcome: "Merged into canonical booking" },
    ]);
  });

  it("selects the ranked UUID directly without relying on a UUID aggregate", async () => {
    const client = await createDatabase();
    clients.push(client);
    await seedDuplicates(client);

    const migration = await readFile(migrationUrl, "utf8");
    await client.exec(migration);

    expect(
      (
        await client.query(
          "select canonical_booking_id from booking_consolidations where source_booking_id = $1",
          [duplicateId],
        )
      ).rows,
    ).toEqual([{ canonical_booking_id: canonicalId }]);
    expect(migration).not.toMatch(/(?:^|[^a-z])max\s*\(\s*id\s*\)/i);
  });

  it("is idempotent and prevents another exact duplicate from being inserted", async () => {
    const client = await createDatabase();
    clients.push(client);
    await seedDuplicates(client);

    const migration = await readFile(migrationUrl, "utf8");
    await client.exec(migration);
    await client.exec(migration);

    expect(
      (await client.query("select count(*)::int as count from booking_consolidations")).rows,
    ).toEqual([{ count: 1 }]);

    await expect(
      client.exec(`
        insert into bookings (id, name, city, region, starts_at, ends_at, status, probability)
        values (
          '30000000-0000-4000-8000-000000000009',
          'Twin Falls County Fair - 2026', 'Filer', 'ID',
          '2026-09-02T16:00:00Z', '2026-09-07T17:00:00Z',
          'new_lead', 'possible'
        );
      `),
    ).rejects.toThrow();
  });
});
