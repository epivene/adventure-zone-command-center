import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { PostgresLeadScoutCrmSearch } from "./lead-scout-crm-search";
import type { LeadDiscoveryCriteria } from "./lead-scout-types";

const criteria: LeadDiscoveryCriteria = {
  originalQuestion: "Find an event between Montana and Utah in September 2026",
  dateFrom: "2026-09-01",
  dateThrough: "2026-09-30",
  month: 9,
  year: 2026,
  regions: ["MT", "ID", "WY", "UT"],
  cities: [],
  geoMode: "corridor",
  routeId: null,
  legId: null,
  eventKeywords: ["fair"],
  fitIntent: "either",
};

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null,
      city text,
      region text,
      consolidated_into_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table bookings (
      id uuid primary key,
      organization_id uuid not null references organizations(id),
      name text not null,
      city text not null,
      region text not null,
      starts_at timestamptz,
      ends_at timestamptz,
      status text not null default 'new_lead',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await client.exec(`
    insert into organizations (id, name, city, region) values
      ('10000000-0000-4000-8000-000000000001', 'Montana September Fair', 'Billings', 'MT'),
      ('10000000-0000-4000-8000-000000000002', 'Idaho Harvest Festival', 'Idaho Falls', 'ID'),
      ('10000000-0000-4000-8000-000000000003', 'Wyoming October Fair', 'Casper', 'WY'),
      ('10000000-0000-4000-8000-000000000004', 'Utah Family Celebration', 'Ogden', 'UT'),
      ('10000000-0000-4000-8000-000000000005', 'Old Duplicate Fair', 'Bozeman', 'MT');

    update organizations
      set consolidated_into_id = '10000000-0000-4000-8000-000000000001'
      where id = '10000000-0000-4000-8000-000000000005';

    insert into bookings (id, organization_id, name, city, region, starts_at, ends_at, status) values
      ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Montana September Fair 2026', 'Billings', 'MT', '2026-09-10T12:00:00Z', '2026-09-12T23:00:00Z', 'possible'),
      ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Idaho Harvest Festival 2024', 'Idaho Falls', 'ID', '2024-09-14T12:00:00Z', '2024-09-15T23:00:00Z', 'confirmed'),
      ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Idaho Harvest Festival 2025', 'Idaho Falls', 'ID', '2025-09-13T12:00:00Z', '2025-09-14T23:00:00Z', 'confirmed'),
      ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', 'Wyoming October Fair 2025', 'Casper', 'WY', '2025-10-05T12:00:00Z', '2025-10-06T23:00:00Z', 'confirmed'),
      ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 'Duplicate September Fair', 'Bozeman', 'MT', '2026-09-20T12:00:00Z', '2026-09-20T23:00:00Z', 'new_lead');
  `);

  return { client, search: new PostgresLeadScoutCrmSearch(client as never) };
}

describe("PostgresLeadScoutCrmSearch", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("ranks requested-year date matches ahead of likely recurring and broader matches", async () => {
    const { client, search } = await createDatabase();
    clients.push(client);

    const results = await search.search(criteria, 10);

    expect(results[0]).toMatchObject({
      organizationId: "10000000-0000-4000-8000-000000000001",
      bookingId: "20000000-0000-4000-8000-000000000001",
      dateConfidence: "confirmed",
      dateFrom: "2026-09-10",
      dateThrough: "2026-09-12",
    });
    expect(results[0]?.reasons).toEqual(expect.arrayContaining(["Confirmed September date", "On requested corridor"]));

    const recurring = results.find((result) => result.organizationId === "10000000-0000-4000-8000-000000000002");
    expect(recurring).toMatchObject({ dateConfidence: "likely_recurring" });
    expect(recurring?.reasons.join(" ")).toMatch(/usually occurs in september/i);
    expect(recurring?.relationshipSummary).toMatch(/2 prior bookings/i);

    const october = results.find((result) => result.organizationId === "10000000-0000-4000-8000-000000000003");
    expect(october?.dateConfidence).toBe("unknown");
    expect(october?.reasons.join(" ")).not.toMatch(/usually occurs in september/i);
  });

  it("excludes consolidated duplicate organizations", async () => {
    const { client, search } = await createDatabase();
    clients.push(client);

    const results = await search.search(criteria, 10);
    expect(results.map((result) => result.organizationId)).not.toContain("10000000-0000-4000-8000-000000000005");
  });

  it("keeps results bounded and uses only the normalized corridor regions", async () => {
    const { client, search } = await createDatabase();
    clients.push(client);

    await client.exec(`
      insert into organizations (id, name, city, region)
      values ('10000000-0000-4000-8000-000000000006', 'Texas Fair', 'Austin', 'TX');
    `);

    const results = await search.search(criteria, 2);
    expect(results).toHaveLength(2);
    expect(results.every((result) => ["MT", "ID", "WY", "UT"].includes(result.region ?? ""))).toBe(true);
    expect(results.some((result) => result.label === "Texas Fair")).toBe(false);
  });
});
