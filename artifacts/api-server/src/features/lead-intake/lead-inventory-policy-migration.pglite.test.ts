import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("20260826 lead inventory policy migration", () => {
  it("invalidates legacy ready snapshots but preserves resolved capacity snapshots", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
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
      await client.exec(`update lead_availability_snapshots set package_availability = '{"status":"resolved","packages":[],"restrictedOptions":[],"blockers":[]}' where row_id = '20000000-0000-4000-8000-000000000001'; update lead_availability_snapshots set ready = true where row_id = '20000000-0000-4000-8000-000000000001';`);
      // Re-running must keep resolved evidence ready while unresolved legacy evidence stays blocked.
      await client.exec(await readFile(new URL("../../../../../lib/db/migrations/20260826_lead_inventory_policy.sql", import.meta.url), "utf8"));
      expect((await client.query("select row_id, ready, package_availability->>'status' as status from lead_availability_snapshots order by row_id")).rows).toEqual([
        { row_id: "10000000-0000-4000-8000-000000000001", ready: false, status: "unresolved" },
        { row_id: "20000000-0000-4000-8000-000000000001", ready: true, status: "resolved" },
      ]);
    } finally { await client.close(); }
  });
});
