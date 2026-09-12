import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

let client: PGlite | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
});

describe("recent outreach follow-up backfill", () => {
  it("fills missing reminders, relabels generic email reminders, and preserves intentional schedules", async () => {
    client = new PGlite();
    await client.exec(`
      create table organizations (
        id uuid primary key,
        name text not null
      );
      create table contacts (
        id uuid primary key,
        organization_id uuid references organizations(id),
        email text,
        created_at timestamptz not null default now()
      );
      create table organization_contacts (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references organizations(id),
        contact_id uuid not null references contacts(id),
        is_primary boolean not null default false,
        active boolean not null default true,
        updated_at timestamptz not null default now()
      );
      create table follow_ups (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid references organizations(id),
        contact_id uuid references contacts(id),
        kind text not null,
        due_at timestamptz not null,
        completed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      insert into organizations values
        ('10000000-0000-4000-8000-000000000001', 'Logger Days'),
        ('10000000-0000-4000-8000-000000000002', 'Cherry Days'),
        ('10000000-0000-4000-8000-000000000003', 'Western Fairs'),
        ('10000000-0000-4000-8000-000000000004', 'Unrelated');
      insert into contacts (id, organization_id, email) values
        ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'McKenzie@LibbyProperties.com'),
        ('20000000-0000-4000-8000-000000000002', null, 'bob.bushta@gmail.com'),
        ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'WFA@fairsnet.org'),
        ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'unrelated@example.com');
      insert into organization_contacts (organization_id, contact_id, is_primary)
      values ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', true);
      insert into follow_ups (organization_id, contact_id, kind, due_at) values
        ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'email', '2026-10-01T18:00:00Z'),
        ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'application_deadline', '2026-10-02T18:00:00Z');
    `);

    const migration = await readFile(
      new URL("../../../../lib/db/migrations/20260912_recent_outreach_followups.sql", import.meta.url),
      "utf8",
    );
    await client.exec(migration);
    await client.exec(migration);

    const result = await client.query<{
      email: string;
      kind: string;
      due_at: string;
    }>(`
      select lower(c.email) as email, f.kind, f.due_at::text
      from follow_ups f
      join contacts c on c.id = f.contact_id
      order by lower(c.email)
    `);

    expect(result.rows).toHaveLength(3);
    const loggerDays = result.rows.find((row) => row.email === "mckenzie@libbyproperties.com");
    expect(loggerDays?.kind).toBe("2027_outreach");
    expect(new Date(loggerDays!.due_at).toISOString()).toBe("2026-10-01T18:00:00.000Z");

    const cherryDays = result.rows.find((row) => row.email === "bob.bushta@gmail.com");
    expect(cherryDays?.kind).toBe("2027_outreach");
    expect(new Date(cherryDays!.due_at).toISOString()).toBe("2026-09-18T18:00:00.000Z");

    const westernFairs = result.rows.find((row) => row.email === "wfa@fairsnet.org");
    expect(westernFairs?.kind).toBe("application_deadline");
    expect(new Date(westernFairs!.due_at).toISOString()).toBe("2026-10-02T18:00:00.000Z");
  });
});
