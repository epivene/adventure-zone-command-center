import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

import { DrizzleFollowUpRepository } from "./follow-up-repository";

const targetFollowUpId = "40000000-0000-4000-8000-000000000001";
const neighborFollowUpId = "40000000-0000-4000-8000-000000000002";
const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const bookingId = "30000000-0000-4000-8000-000000000001";
const targetDueAt = "2026-09-01T15:00:00.000Z";
const neighborDueAt = "2026-09-02T15:00:00.000Z";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table contacts (
      id uuid primary key,
      organization_id uuid references organizations(id),
      first_name text not null,
      last_name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table bookings (
      id uuid primary key,
      organization_id uuid references organizations(id),
      primary_contact_id uuid references contacts(id),
      name text not null,
      city text not null,
      region text not null,
      status text not null default 'new_lead',
      probability text not null default 'possible',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table follow_ups (
      id uuid primary key,
      booking_id uuid references bookings(id),
      organization_id uuid references organizations(id),
      contact_id uuid references contacts(id),
      kind text not null,
      due_at timestamptz not null,
      completed_at timestamptz,
      outcome text,
      next_follow_up_id uuid references follow_ups(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table call_sessions (
      id uuid primary key,
      request_key uuid,
      organization_id uuid references organizations(id),
      contact_id uuid references contacts(id),
      booking_id uuid references bookings(id),
      follow_up_id uuid references follow_ups(id),
      next_follow_up_id uuid references follow_ups(id),
      disposition text not null,
      resulting_booking_status text,
      note_activity_id uuid,
      started_at timestamptz not null,
      ended_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table audit_entries (
      id uuid primary key default gen_random_uuid(),
      entity_type text not null,
      entity_id uuid not null,
      action text not null,
      before jsonb,
      after jsonb,
      reverses_entry_id uuid unique references audit_entries(id),
      created_at timestamptz not null default now()
    );
  `);
  const db = drizzle(client, { schema });
  return { client, db, repository: new DrizzleFollowUpRepository(db as never) };
}

async function seedLinkedFollowUps(client: PGlite) {
  await client.exec(`
    insert into organizations (id, name)
    values ('${organizationId}', 'Adventure Zone');

    insert into contacts (id, organization_id, first_name, last_name)
    values ('${contactId}', '${organizationId}', 'Ada', 'Caller');

    insert into bookings (id, organization_id, primary_contact_id, name, city, region)
    values ('${bookingId}', '${organizationId}', '${contactId}', 'County Fair', 'Austin', 'TX');

    insert into follow_ups (
      id, organization_id, contact_id, booking_id, kind, due_at, completed_at, outcome
    ) values (
      '${targetFollowUpId}', '${organizationId}', '${contactId}', '${bookingId}',
      'call', '${targetDueAt}', null, null
    );

    insert into follow_ups (
      id, organization_id, contact_id, booking_id, kind, due_at, completed_at, outcome,
      next_follow_up_id
    ) values (
      '${neighborFollowUpId}', '${organizationId}', '${contactId}', '${bookingId}',
      'email', '${neighborDueAt}', null, null, '${targetFollowUpId}'
    );

    insert into call_sessions (
      id, organization_id, contact_id, booking_id, follow_up_id, next_follow_up_id,
      disposition, started_at
    ) values (
      '50000000-0000-4000-8000-000000000001', '${organizationId}', '${contactId}',
      '${bookingId}', '${targetFollowUpId}', '${targetFollowUpId}',
      'left_voicemail', '2026-08-30T15:00:00.000Z'
    );
  `);
}

describe("DrizzleFollowUpRepository delete", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("unlinks inbound references, deletes only the target, preserves parents, and writes a minimal delete audit", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    await seedLinkedFollowUps(client);

    const result = await repository.delete(targetFollowUpId);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(
      (await client.query("select id from follow_ups order by id")).rows,
    ).toEqual([{ id: neighborFollowUpId }]);
    expect(
      (
        await client.query(
          "select next_follow_up_id from follow_ups where id = $1",
          [neighborFollowUpId],
        )
      ).rows,
    ).toEqual([{ next_follow_up_id: null }]);
    expect(
      (
        await client.query(`
      select follow_up_id, next_follow_up_id
      from call_sessions
      order by id
    `)
      ).rows,
    ).toEqual([{ follow_up_id: null, next_follow_up_id: null }]);
    expect(
      (await client.query("select count(*)::int as count from organizations"))
        .rows,
    ).toEqual([{ count: 1 }]);
    expect(
      (await client.query("select count(*)::int as count from contacts")).rows,
    ).toEqual([{ count: 1 }]);
    expect(
      (await client.query("select count(*)::int as count from bookings")).rows,
    ).toEqual([{ count: 1 }]);
    expect(
      (
        await client.query(`
      select entity_type, entity_id, action, before, after
      from audit_entries
    `)
      ).rows,
    ).toEqual([
      {
        entity_type: "follow_up",
        entity_id: targetFollowUpId,
        action: "delete",
        before: null,
        after: null,
      },
    ]);
  });

  it("rolls back unlink, audit, and deletion when deleting the target fails", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    await seedLinkedFollowUps(client);
    await client.exec(`
      create function reject_follow_up_delete() returns trigger language plpgsql as $$
      begin
        raise exception 'forced delete failure';
      end;
      $$;

      create trigger reject_follow_up_delete
      before delete on follow_ups
      for each row
      when (old.id = '${targetFollowUpId}'::uuid)
      execute function reject_follow_up_delete();
    `);

    await expect(repository.delete(targetFollowUpId)).rejects.toThrow(
      "forced delete failure",
    );

    expect(
      (await client.query("select id from follow_ups order by id")).rows,
    ).toEqual([{ id: targetFollowUpId }, { id: neighborFollowUpId }]);
    expect(
      (
        await client.query(
          "select next_follow_up_id from follow_ups where id = $1",
          [neighborFollowUpId],
        )
      ).rows,
    ).toEqual([{ next_follow_up_id: targetFollowUpId }]);
    expect(
      (
        await client.query(`
      select follow_up_id, next_follow_up_id
      from call_sessions
      order by id
    `)
      ).rows,
    ).toEqual([
      {
        follow_up_id: targetFollowUpId,
        next_follow_up_id: targetFollowUpId,
      },
    ]);
    expect(
      (await client.query("select count(*)::int as count from audit_entries"))
        .rows,
    ).toEqual([{ count: 0 }]);
  });
});
