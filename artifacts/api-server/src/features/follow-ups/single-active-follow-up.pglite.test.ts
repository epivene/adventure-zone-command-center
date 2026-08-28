import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { DrizzleFollowUpRepository } from "./follow-up-repository";

const bookingId = "30000000-0000-4000-8000-000000000001";
const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";

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
      id uuid primary key default gen_random_uuid(),
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
      organization_id uuid,
      contact_id uuid,
      booking_id uuid,
      follow_up_id uuid,
      next_follow_up_id uuid,
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
      reverses_entry_id uuid unique,
      created_at timestamptz not null default now()
    );
    insert into organizations (id, name) values ('${organizationId}', 'Organizer');
    insert into contacts (id, organization_id, first_name, last_name)
      values ('${contactId}', '${organizationId}', 'Jean', 'Ray');
    insert into bookings (id, organization_id, primary_contact_id, name, city, region)
      values ('${bookingId}', '${organizationId}', '${contactId}', 'Sheridan Celebrates', 'Sheridan', 'CO');
  `);
  return { client, repository: new DrizzleFollowUpRepository(drizzle(client, { schema }) as never) };
}

describe("single active follow-up", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("replaces the previous open follow-up for the same booking and preserves it as history", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);

    await repository.create({
      bookingId,
      organizationId,
      contactId,
      kind: "email",
      dueAt: new Date("2026-08-28T15:00:00.000Z"),
    });
    await repository.create({
      bookingId,
      organizationId,
      contactId,
      kind: "call",
      dueAt: new Date("2026-09-01T15:00:00.000Z"),
    });

    const rows = (await client.query(`
      select kind, completed_at, outcome
      from follow_ups
      where booking_id = '${bookingId}'
      order by created_at, kind
    `)).rows as Array<{ kind: string; completed_at: string | null; outcome: string | null }>;

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.completed_at === null)).toEqual([
      expect.objectContaining({ kind: "call" }),
    ]);
    expect(rows.find((row) => row.kind === "email")).toEqual(
      expect.objectContaining({ outcome: "Replaced by newer follow-up" }),
    );
  });
});
