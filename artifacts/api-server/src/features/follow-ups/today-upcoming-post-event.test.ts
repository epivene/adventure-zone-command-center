import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import { businessDayBounds } from "@/lib/business-date";
import { createDrizzleTodayDashboardRepository } from "./today-query";

const now = new Date("2026-08-15T15:00:00.000Z");

const bookingIds = {
  confirmedFuture: "30000000-0000-4000-8000-000000000001",
  confirmedToday: "30000000-0000-4000-8000-000000000002",
  confirmedMultiDay: "30000000-0000-4000-8000-000000000003",
  confirmedPast: "30000000-0000-4000-8000-000000000004",
  possibleFuture: "30000000-0000-4000-8000-000000000005",
  confirmedUndated: "30000000-0000-4000-8000-000000000006",
  confirmedPastWithFutureAction: "30000000-0000-4000-8000-000000000007",
} as const;

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table bookings (
      id uuid primary key,
      organization_id uuid,
      primary_contact_id uuid,
      name text not null,
      venue_name text,
      address_1 text,
      city text not null default '',
      region text not null default '',
      postal_code text,
      latitude double precision,
      longitude double precision,
      starts_at timestamptz,
      ends_at timestamptz,
      status text not null,
      probability text not null default 'possible',
      travel_leg_id uuid,
      act_record_id text,
      organization_location_id uuid,
      notes text,
      physical_attraction_total integer,
      attraction_total_approval_reason text,
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

async function seedCases(client: PGlite) {
  await client.exec(`
    insert into bookings (id, name, starts_at, ends_at, status) values
      ('${bookingIds.confirmedFuture}', 'Confirmed Future', '2026-08-18T17:00:00Z', null, 'confirmed'),
      ('${bookingIds.confirmedToday}', 'Confirmed Today', '2026-08-15T16:00:00Z', null, 'confirmed'),
      ('${bookingIds.confirmedMultiDay}', 'Confirmed Multi Day', '2026-08-14T17:00:00Z', '2026-08-16T17:00:00Z', 'confirmed'),
      ('${bookingIds.confirmedPast}', 'Confirmed Past', '2026-08-13T17:00:00Z', '2026-08-14T23:00:00Z', 'confirmed'),
      ('${bookingIds.possibleFuture}', 'Possible Future', '2026-09-20T17:00:00Z', null, 'possible'),
      ('${bookingIds.confirmedUndated}', 'Confirmed Undated', null, null, 'confirmed'),
      ('${bookingIds.confirmedPastWithFutureAction}', 'Confirmed Past With Action', '2026-08-12T17:00:00Z', '2026-08-13T23:00:00Z', 'confirmed');

    insert into follow_ups (id, booking_id, kind, due_at, completed_at) values
      ('40000000-0000-4000-8000-000000000001', '${bookingIds.confirmedPastWithFutureAction}', 'call', '2026-08-20T17:00:00Z', null);
  `);
}

describe("Today upcoming/post-event separation", () => {
  it("keeps confirmed upcoming/in-progress events out of plan work and returns past confirmed events", async () => {
    const client = await createDatabase();
    try {
      await seedCases(client);
      const repository = createDrizzleTodayDashboardRepository(drizzle(client) as never);
      const { start, end } = businessDayBounds(now);

      const plan = await repository.listNeedsFollowUpPlan(end, {
        page: 1,
        pageSize: 50,
      });
      const needsPlanIds = plan.records.map(({ id }) => id);

      expect(needsPlanIds).not.toContain(bookingIds.confirmedFuture);
      expect(needsPlanIds).not.toContain(bookingIds.confirmedToday);
      expect(needsPlanIds).not.toContain(bookingIds.confirmedMultiDay);
      expect(needsPlanIds).toContain(bookingIds.confirmedPast);
      expect(needsPlanIds).toContain(bookingIds.possibleFuture);
      expect(needsPlanIds).toContain(bookingIds.confirmedUndated);
      expect(needsPlanIds).not.toContain(bookingIds.confirmedPastWithFutureAction);

      const upcoming = await repository.listUpcomingEvents(start, 20);
      const upcomingIds = upcoming.map(({ id }) => id);

      expect(upcomingIds).toContain(bookingIds.confirmedFuture);
      expect(upcomingIds).toContain(bookingIds.confirmedToday);
      expect(upcomingIds).toContain(bookingIds.confirmedMultiDay);
    } finally {
      await client.close();
    }
  });
});