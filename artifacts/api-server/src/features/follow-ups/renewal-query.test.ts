import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import {
  classifyRenewalAttention,
  listRenewals,
  sortRenewalItems,
  type RenewalItem,
} from "./renewal-query";

const now = new Date("2026-08-15T03:00:00.000Z");

function renewal(
  id: string,
  dueAt: Date | null,
  attention: RenewalItem["attention"],
  followUpId = `${id}-follow-up`,
): RenewalItem {
  return {
    id,
    organizationId: null,
    primaryContactId: null,
    name: id,
    status: "renewal_due",
    probability: "possible",
    followUpId: dueAt ? followUpId : null,
    dueAt,
    attention,
  };
}

describe("renewal attention", () => {
  it("marks an overdue dated renewal as overdue", () => {
    expect(
      classifyRenewalAttention(new Date("2026-08-13T17:00:00.000Z"), now),
    ).toBe("overdue");
  });

  it("marks a renewal exactly 30 business-calendar days away as soon", () => {
    expect(
      classifyRenewalAttention(new Date("2026-09-13T17:00:00.000Z"), now),
    ).toBe("soon");
  });

  it("keeps a renewal 31 business-calendar days away quiet", () => {
    expect(
      classifyRenewalAttention(new Date("2026-09-14T17:00:00.000Z"), now),
    ).toBe("later");
  });

  it("uses needs_plan for an undated renewal item", () => {
    expect(classifyRenewalAttention(null, now)).toBe("needs_plan");
  });

  it("sorts overdue first, then dated renewals, then undated plans with stable ties", () => {
    const tiedDate = new Date("2026-08-25T17:00:00.000Z");
    const items = [
      renewal("undated", null, "needs_plan"),
      renewal("later", new Date("2026-10-01T17:00:00.000Z"), "later"),
      renewal("tie-b", tiedDate, "soon", "follow-up-b"),
      renewal("overdue", new Date("2026-08-10T17:00:00.000Z"), "overdue"),
      renewal("tie-a", tiedDate, "soon", "follow-up-a"),
    ];

    expect(sortRenewalItems(items).map(({ id }) => id)).toEqual([
      "overdue",
      "tie-a",
      "tie-b",
      "later",
      "undated",
    ]);
  });
});

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table bookings (
      id uuid primary key,
      organization_id uuid,
      primary_contact_id uuid,
      name text not null,
      city text not null default '',
      region text not null default '',
      starts_at timestamptz,
      status text not null,
      probability text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table follow_ups (
      id uuid primary key,
      booking_id uuid references bookings(id),
      organization_id uuid,
      contact_id uuid,
      kind text not null,
      due_at timestamptz not null,
      completed_at timestamptz,
      outcome text,
      next_follow_up_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  return client;
}

const bookingIds = {
  activePast: "30000000-0000-4000-8000-000000000001",
  renewalFuture: "30000000-0000-4000-8000-000000000002",
  renewalOverdue: "30000000-0000-4000-8000-000000000003",
  renewalNoPlan: "30000000-0000-4000-8000-000000000004",
  completedFuture: "30000000-0000-4000-8000-000000000005",
  completedOverdue: "30000000-0000-4000-8000-000000000006",
  completedClosedOnly: "30000000-0000-4000-8000-000000000007",
  declinedFuture: "30000000-0000-4000-8000-000000000008",
} as const;

async function seedCases(client: PGlite) {
  await client.exec(`
    insert into bookings (id, name, starts_at, status, probability) values
      ('${bookingIds.activePast}', 'Active Past Event', '2026-06-01T17:00:00Z', 'possible', 'possible'),
      ('${bookingIds.renewalFuture}', 'Renewal Future', '2026-06-02T17:00:00Z', 'renewal_due', 'possible'),
      ('${bookingIds.renewalOverdue}', 'Renewal Overdue', '2026-06-03T17:00:00Z', 'renewal_due', 'possible'),
      ('${bookingIds.renewalNoPlan}', 'Renewal Needs Plan', '2026-06-04T17:00:00Z', 'renewal_due', 'possible'),
      ('${bookingIds.completedFuture}', 'Completed Future Renewal', '2026-06-05T17:00:00Z', 'completed', 'possible'),
      ('${bookingIds.completedOverdue}', 'Completed Overdue Renewal', '2026-06-06T17:00:00Z', 'completed', 'possible'),
      ('${bookingIds.completedClosedOnly}', 'Completed Closed Only', '2026-06-07T17:00:00Z', 'completed', 'possible'),
      ('${bookingIds.declinedFuture}', 'Declined Future', '2026-06-08T17:00:00Z', 'declined', 'possible');

    insert into follow_ups (id, booking_id, kind, due_at, completed_at) values
      ('40000000-0000-4000-8000-000000000001', '${bookingIds.renewalFuture}', 'call', '2026-09-01T17:00:00Z', null),
      ('40000000-0000-4000-8000-000000000002', '${bookingIds.renewalOverdue}', 'call', '2026-08-10T17:00:00Z', null),
      ('40000000-0000-4000-8000-000000000003', '${bookingIds.completedFuture}', 'call', '2026-09-05T17:00:00Z', null),
      ('40000000-0000-4000-8000-000000000004', '${bookingIds.completedOverdue}', 'call', '2026-08-11T17:00:00Z', null),
      ('40000000-0000-4000-8000-000000000005', '${bookingIds.completedClosedOnly}', 'call', '2026-09-10T17:00:00Z', '2026-08-12T17:00:00Z'),
      ('40000000-0000-4000-8000-000000000006', '${bookingIds.declinedFuture}', 'call', '2026-09-12T17:00:00Z', null);
  `);
}

describe("listRenewals", () => {
  it("classifies only explicit renewal work and leaves follow-ups untouched", async () => {
    const client = await createDatabase();
    try {
      await seedCases(client);
      const before = await client.query(`
        select id, booking_id, kind, due_at, completed_at
        from follow_ups
        order by id
      `);

      const items = await listRenewals(drizzle(client) as never, now);

      expect(items.map(({ id }) => id)).toEqual([
        bookingIds.renewalOverdue,
        bookingIds.completedOverdue,
        bookingIds.renewalFuture,
        bookingIds.completedFuture,
        bookingIds.renewalNoPlan,
      ]);
      expect(items.find(({ id }) => id === bookingIds.renewalOverdue)).toMatchObject({
        attention: "overdue",
        followUpId: "40000000-0000-4000-8000-000000000002",
      });
      expect(items.find(({ id }) => id === bookingIds.completedOverdue)).toMatchObject({
        attention: "overdue",
        followUpId: "40000000-0000-4000-8000-000000000004",
      });
      expect(items.find(({ id }) => id === bookingIds.renewalFuture)).toMatchObject({
        attention: "soon",
        followUpId: "40000000-0000-4000-8000-000000000001",
      });
      expect(items.find(({ id }) => id === bookingIds.renewalNoPlan)).toMatchObject({
        attention: "needs_plan",
        dueAt: null,
        followUpId: null,
      });
      expect(items.some(({ id }) => id === bookingIds.activePast)).toBe(false);
      expect(items.some(({ id }) => id === bookingIds.completedClosedOnly)).toBe(false);
      expect(items.some(({ id }) => id === bookingIds.declinedFuture)).toBe(false);

      const after = await client.query(`
        select id, booking_id, kind, due_at, completed_at
        from follow_ups
        order by id
      `);
      expect(after.rows).toEqual(before.rows);
    } finally {
      await client.close();
    }
  });
});
