import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { listActiveFollowUpExportRows } from "./follow-up-export";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000002";

describe("listActiveFollowUpExportRows", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("returns every active follow-up for selected profiles and no synthesized opportunity actions", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      create table organizations (
        id uuid primary key, name text not null, city text, region text
      );
      create table contacts (id uuid primary key);
      create table organization_contacts (
        organization_id uuid not null, contact_id uuid not null,
        active boolean not null default true, is_primary boolean not null default false
      );
      create table bookings (
        id uuid primary key, organization_id uuid
      );
      create table follow_ups (
        id uuid primary key, organization_id uuid, booking_id uuid, contact_id uuid,
        kind text not null, due_at timestamptz not null, completed_at timestamptz
      );
      create table booking_opportunities (
        id uuid primary key, organization_id uuid, next_action_kind text,
        next_action_due_at timestamptz
      );

      insert into organizations values
        ('${organizationId}', 'Killdeer Days', 'Killdeer', 'ND'),
        ('${otherOrganizationId}', 'Other Fair', 'Other', 'ND');
      insert into contacts values ('20000000-0000-4000-8000-000000000001');
      insert into organization_contacts values
        ('${organizationId}', '20000000-0000-4000-8000-000000000001', true, true);
      insert into bookings values
        ('30000000-0000-4000-8000-000000000001', '${organizationId}');

      insert into follow_ups values
        ('40000000-0000-4000-8000-000000000001', '${organizationId}', null, null, 'call', '2026-09-21T17:00:00Z', null),
        ('40000000-0000-4000-8000-000000000002', '${organizationId}', null, null, 'email', '2026-09-22T17:00:00Z', null),
        ('40000000-0000-4000-8000-000000000003', null, '30000000-0000-4000-8000-000000000001', null, 'booking check-in', '2026-09-23T17:00:00Z', null),
        ('40000000-0000-4000-8000-000000000004', null, null, '20000000-0000-4000-8000-000000000001', 'contact reply', '2026-09-24T17:00:00Z', null),
        ('40000000-0000-4000-8000-000000000005', '${organizationId}', null, null, 'completed', '2026-09-20T17:00:00Z', now()),
        ('40000000-0000-4000-8000-000000000006', '${otherOrganizationId}', null, null, 'other', '2026-09-25T17:00:00Z', null);
      insert into booking_opportunities values
        ('50000000-0000-4000-8000-000000000001', '${organizationId}', 'opportunity only', '2026-09-26T17:00:00Z');
    `);

    const rows = await listActiveFollowUpExportRows(
      drizzle(client) as never,
      [organizationId],
    );

    expect(rows.map((row) => row.id)).toEqual([
      "40000000-0000-4000-8000-000000000001",
      "40000000-0000-4000-8000-000000000002",
      "40000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
    ]);
    expect(rows.map((row) => row.kind)).not.toContain("opportunity only");
    expect(rows[0]).toMatchObject({
      organizationName: "Killdeer Days",
      city: "Killdeer",
      region: "ND",
    });
  });
});
