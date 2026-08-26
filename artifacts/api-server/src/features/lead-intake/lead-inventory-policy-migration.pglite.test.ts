import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("20260826 lead inventory policy migration", () => {
  it("invalidates legacy ready snapshots but preserves resolved capacity snapshots", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        create table package_templates (
          id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
          base_attraction_count integer not null default 1, active boolean not null default true,
          customer_description text, booking_talking_points text, operational_requirements text,
          setup_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
        );
        insert into package_templates
          (code, name, customer_description, booking_talking_points, operational_requirements, setup_notes)
        values (
          'pirates_rebellion', 'Pirate''s Rebellion',
          'A water-focused pirate package centered on a large inflatable pool.',
          'Best fit for warm-weather events that can support a massive pool.',
          'Plan for an extremely-flat ground surface. Water requires 45,000–50,000 gallons.',
          'Schedule pool filling as part of setup.'
        );
        create table lead_import_rows (id uuid primary key);
        create table lead_availability_snapshots (
          id uuid primary key default gen_random_uuid(), row_id uuid not null references lead_import_rows(id),
          review_version integer not null, proposed_start_date date not null, proposed_end_date date not null,
          ready boolean not null, checked_by text not null, checked_at timestamptz not null,
          selected_calendar_ids jsonb not null, source_events jsonb not null, reservations jsonb not null
        );
        insert into lead_import_rows values ('10000000-0000-4000-8000-000000000001'), ('20000000-0000-4000-8000-000000000001');
        insert into lead_availability_snapshots
          (row_id, review_version, proposed_start_date, proposed_end_date, ready, checked_by, checked_at, selected_calendar_ids, source_events, reservations)
        values
          ('10000000-0000-4000-8000-000000000001', 1, '2026-09-01', '2026-09-02', true, 'owner', now(), '[]', '[]', '[]'),
          ('20000000-0000-4000-8000-000000000001', 1, '2026-09-01', '2026-09-02', true, 'owner', now(), '[]', '[]', '[]');
      `);
      await client.exec(await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_inventory_policy.sql", import.meta.url), "utf8"));
      expect((await client.query("select customer_description, booking_talking_points, operational_requirements from package_templates where code = 'pirates_rebellion'")).rows[0]).toMatchObject({
        customer_description: expect.not.stringMatching(/massive pool|extremely.flat|45,000|50,000/i),
        booking_talking_points: expect.not.stringMatching(/massive pool|extremely.flat|45,000|50,000/i),
        operational_requirements: expect.not.stringMatching(/massive pool|extremely.flat|45,000|50,000/i),
      });
      await client.exec(`update lead_availability_snapshots set package_availability = '{"status":"resolved","packages":[],"restrictedOptions":[],"blockers":[]}' where row_id = '20000000-0000-4000-8000-000000000001'; update lead_availability_snapshots set ready = true where row_id = '20000000-0000-4000-8000-000000000001';`);
      // Re-running must keep resolved evidence ready while unresolved legacy evidence stays blocked.
      await client.exec(await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_inventory_policy.sql", import.meta.url), "utf8"));
      expect((await client.query("select row_id, ready, package_availability->>'status' as status from lead_availability_snapshots order by row_id")).rows).toEqual([
        { row_id: "10000000-0000-4000-8000-000000000001", ready: false, status: "unresolved" },
        { row_id: "20000000-0000-4000-8000-000000000001", ready: true, status: "resolved" },
      ]);
    } finally { await client.close(); }
  });

  it("preserves valid admin-edited capacities including zero on rerun", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        create table package_templates (
          id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
          base_attraction_count integer not null, active boolean not null default true,
          created_at timestamptz not null default now(), updated_at timestamptz not null default now()
        );
        insert into package_templates (code, name, base_attraction_count) values
          ('adventure_zone', 'Adventure Zone', 10),
          ('pirates_rebellion', 'Pirate''s Rebellion', 3),
          ('weekend_warriors', 'Warrior''s Playground', 5),
          ('mini_zone', 'Mini Zone', 5);
        create table lead_availability_snapshots (id uuid primary key default gen_random_uuid(), ready boolean not null);
      `);
      const migrationSql = await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_inventory_policy.sql", import.meta.url), "utf8");
      await client.exec(migrationSql);
      await client.exec(`
        update package_templates set normal_capacity = case code
          when 'adventure_zone' then 0
          when 'pirates_rebellion' then 2
          when 'weekend_warriors' then 0
          when 'mini_zone' then 4
        end;
      `);
      await client.exec(migrationSql);
      expect((await client.query("select code, normal_capacity from package_templates order by code")).rows).toEqual([
        { code: "adventure_zone", normal_capacity: 0 },
        { code: "mini_zone", normal_capacity: 4 },
        { code: "pirates_rebellion", normal_capacity: 2 },
        { code: "weekend_warriors", normal_capacity: 0 },
      ]);
    } finally { await client.close(); }
  }, 15_000);

  it("preserves a populated unresolved availability snapshot on rerun", async () => {
    const client = new PGlite();
    const packageAvailability = {
      status: "unresolved",
      packages: [{ packageKey: "adventure_zone", normalCapacity: 5, booked: 2, available: 3 }],
      restrictedOptions: [{ packageKey: "pirates_rebellion_fourth", approvalRequired: true }],
      blockers: ["ambiguous Calendar package evidence"],
    };
    try {
      await client.exec(`
        create table package_templates (
          id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
          base_attraction_count integer not null, active boolean not null default true,
          created_at timestamptz not null default now(), updated_at timestamptz not null default now()
        );
        create table lead_availability_snapshots (id uuid primary key default gen_random_uuid(), ready boolean not null);
      `);
      const migrationSql = await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_inventory_policy.sql", import.meta.url), "utf8");
      await client.exec(migrationSql);
      await client.query(
        "insert into lead_availability_snapshots (ready, package_availability) values ($1, $2::jsonb)",
        [true, JSON.stringify(packageAvailability)],
      );
      await client.exec(migrationSql);
      expect((await client.query("select ready, package_availability from lead_availability_snapshots")).rows)
        .toEqual([{ ready: true, package_availability: packageAvailability }]);
    } finally { await client.close(); }
  }, 15_000);

});
