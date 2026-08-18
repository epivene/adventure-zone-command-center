import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listTodayUpcomingEvents } from "./today-upcoming-events";

let client: PGlite;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    create table bookings (
      id uuid primary key,
      organization_id uuid,
      primary_contact_id uuid,
      name text not null,
      city text not null default '',
      region text not null default '',
      starts_at timestamptz,
      ends_at timestamptz
    );

    insert into bookings (id, name, city, region, starts_at, ends_at) values
      ('10000000-0000-4000-8000-000000000001', 'Past Potential Sentinel', 'Big Timber', 'MT', '2026-01-05T17:00:00Z', '2100-01-01T00:00:00Z'),
      ('10000000-0000-4000-8000-000000000002', 'Past Finished Event', 'Denver', 'CO', '2026-08-10T17:00:00Z', '2026-08-11T23:00:00Z'),
      ('10000000-0000-4000-8000-000000000003', 'In Progress Event', 'Rapid City', 'SD', '2026-08-16T17:00:00Z', '2026-08-18T23:00:00Z'),
      ('10000000-0000-4000-8000-000000000004', 'Future Event', 'Billings', 'MT', '2026-09-05T17:00:00Z', null);
  `);
});

afterEach(async () => {
  await client.close();
});

describe("Today upcoming events", () => {
  it("treats year-2100 ACT end dates as open-ended sentinels instead of future event dates", async () => {
    const events = await listTodayUpcomingEvents(
      drizzle(client) as never,
      new Date("2026-08-17T06:00:00.000Z"),
      5,
    );

    expect(events.map((event) => event.name)).toEqual([
      "In Progress Event",
      "Future Event",
    ]);
  });
});