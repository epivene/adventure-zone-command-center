import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { LeadAvailabilityRepository } from "./lead-availability-repository";

describe("LeadAvailabilityRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("uses selected Google calendars and atomically saves an auditable snapshot after revalidating the lead version", async () => {
    const client = new PGlite(); clients.push(client);
    await client.exec(`
      create table lead_import_rows (id uuid primary key, state text not null, review_version integer not null, selected_organization_id uuid, confirmed_start_date date, confirmed_end_date date, confirmed_recipient_email text, recipient_confirmed boolean not null, introduction_suitable boolean not null, updated_at timestamptz not null default now());
      create table google_workspace_connections (id uuid primary key, status text not null);
      create table google_workspace_calendar_scopes (connection_id uuid not null, calendar_id text not null, summary text not null, primary_calendar boolean not null, selected boolean not null);
      create table lead_availability_snapshots (id uuid primary key default gen_random_uuid(), row_id uuid not null, review_version integer not null, proposed_start_date date not null, proposed_end_date date not null, ready boolean not null, checked_by text not null, checked_at timestamptz not null, selected_calendar_ids jsonb not null, source_events jsonb not null, reservations jsonb not null);
      insert into lead_import_rows values ('10000000-0000-4000-8000-000000000001','verified',4,'30000000-0000-4000-8000-000000000001','2026-09-10','2026-09-12','events@example.com',true,true,now());
      insert into google_workspace_connections values ('20000000-0000-4000-8000-000000000001','connected');
      insert into google_workspace_calendar_scopes values ('20000000-0000-4000-8000-000000000001','zone-a','Adventure Zone',false,true);
    `);
    const repository = new LeadAvailabilityRepository(drizzle(client, { schema }) as never);
    await expect(repository.selectedCalendars()).resolves.toEqual([{ id: "zone-a", summary: "Adventure Zone", primary: false }]);
    await expect(repository.save({
      rowId: "10000000-0000-4000-8000-000000000001", expectedVersion: 4, organizationId: "30000000-0000-4000-8000-000000000001", recipientEmail: "events@example.com", startDate: "2026-09-10", endDate: "2026-09-12",
      ready: false, proposedWindow: { startDate: "2026-09-08", endDate: "2026-09-13" }, checkedAt: "2026-08-25T12:00:00.000Z", checkedBy: "owner",
      selectedCalendarIds: ["zone-a"], sourceEvents: [{ calendarId: "zone-a", eventId: "event-1", updated: "2026-08-25T11:00:00.000Z" }], reservations: [{ calendarEventId: "event-1", confidence: "ambiguous" }],
    })).resolves.toEqual({ reviewVersion: 5 });
    expect((await client.query("select review_version from lead_import_rows")).rows).toEqual([{ review_version: 5 }]);
    expect((await client.query("select proposed_start_date, ready, selected_calendar_ids, source_events from lead_availability_snapshots")).rows).toEqual([expect.objectContaining({ proposed_start_date: "2026-09-08", ready: false, selected_calendar_ids: ["zone-a"] })]);
  });
});