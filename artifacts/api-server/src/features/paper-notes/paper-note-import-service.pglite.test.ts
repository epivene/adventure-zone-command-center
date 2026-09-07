import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaperNoteImportService } from "./paper-note-import-service";
import { PaperNotePhoneService } from "./paper-note-phone-service";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";
const entryId = "30000000-0000-4000-8000-000000000001";
const requestKey = "40000000-0000-4000-8000-000000000001";

function rowValue(rows: unknown[], index: number, key: string): unknown {
  const row = rows[index];
  return row && typeof row === "object" && !Array.isArray(row) && key in row
    ? (row as Record<string, unknown>)[key]
    : undefined;
}

const review = {
  event: { name: "County Fair", city: "Minot", region: "ND", venue: "Fairgrounds", eventDateText: "June 22", startsOn: "2026-06-22", endsOn: null, pageYearConfirmed: true },
  activity: { occurredOn: null, method: "call", outcome: "Requested info", summary: "Spoke with Tina." },
  contacts: [],
  organizationPhones: [],
  oldReminder: "Call Monday",
  starredOnPaper: true,
  generalNotes: [],
  destination: { mode: "new_profile", eventFamilyId: null },
  conflicts: {},
  currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
};

async function harness() {
  const client = new PGlite();
  await client.exec(`
    create table paper_note_batches (
      id uuid primary key,
      created_by text not null,
      status text not null,
      import_request_key uuid,
      import_summary jsonb,
      import_started_at timestamptz,
      imported_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create table paper_note_entries (
      id uuid primary key,
      batch_id uuid not null,
      page_id uuid not null,
      source_order integer not null default 0,
      state text not null,
      review_payload jsonb not null,
      extraction_payload jsonb not null,
      imported_organization_id uuid,
      imported_organization_location_id uuid,
      imported_activity_id uuid,
      import_result jsonb,
      updated_at timestamptz not null default now()
    );
    create table organizations (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      place_type text not null default 'other',
      city text,
      region text,
      phone text,
      normalized_phone text,
      consolidated_into_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table organization_locations (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id),
      label text not null,
      venue_name text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table contacts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid,
      first_name text not null,
      last_name text not null,
      email text,
      phone text,
      normalized_phone text,
      job_title text,
      organization_location_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table organization_contacts (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      contact_id uuid not null,
      role text,
      is_primary boolean not null default false,
      active boolean not null default true,
      source text not null default 'local',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(organization_id, contact_id)
    );
    create table contact_phones (
      id uuid primary key default gen_random_uuid(), contact_id uuid not null, number text not null,
      normalized_number text, type text not null default 'unknown', extension text, label text,
      instructions text, status text not null default 'active', "primary" boolean not null default false,
      source text not null default 'local', source_paper_note_entry_id uuid, do_not_call_at timestamptz,
      do_not_call_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table organization_phones (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, organization_location_id uuid,
      number text not null, normalized_number text, type text not null default 'unknown', extension text,
      normalized_extension text, label text, instructions text, status text not null default 'active',
      "primary" boolean not null default false, source text not null default 'local', source_paper_note_entry_id uuid,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table activities (
      id uuid primary key default gen_random_uuid(), organization_id uuid, contact_id uuid, booking_id uuid,
      kind text not null, subject text, status text, body text not null, occurred_at timestamptz,
      timeline_sort_at timestamptz not null, date_is_import_fallback boolean not null default false,
      source_type text, organization_location_id uuid, paper_note_entry_id uuid unique,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table follow_ups (
      id uuid primary key default gen_random_uuid(), booking_id uuid, organization_id uuid, contact_id uuid,
      kind text not null, due_at timestamptz not null, completed_at timestamptz, outcome text,
      organization_location_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table event_family_members (
      id uuid primary key default gen_random_uuid(), family_id uuid not null, organization_id uuid not null,
      source text not null, created_at timestamptz not null default now()
    );
    create table audit_entries (
      id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null,
      action text not null, before jsonb, after jsonb, created_at timestamptz not null default now()
    );
  `);
  await client.query(`insert into paper_note_batches(id, created_by, status) values($1, 'owner', 'review')`, [batchId]);
  await client.query(`
    insert into paper_note_entries(id, batch_id, page_id, state, review_payload, extraction_payload)
    values($1, $2, $3, 'approved', $4::jsonb, $5::jsonb)
  `, [entryId, batchId, pageId, JSON.stringify(review), JSON.stringify({ transcription: "County Fair — call Monday ★" })]);
  const db = drizzle(client);
  const preflight = { preflight: vi.fn(async () => ({
    ready: true, batchId, approvedCount: 1, skippedCount: 0, blocking: [],
    preview: { profilesCreated: 1, profilesUpdated: 0, locationsCreated: 0, contactsCreated: 0, contactsLinked: 0, phonesCreatedOrUpdated: 0, historicalNotesCreated: 1, followUpsCreated: 0, entriesSkipped: 0 },
  })) };
  return { client, db, preflight, service: new PaperNoteImportService(db as never, preflight as any, new PaperNotePhoneService()) };
}

describe("PaperNoteImportService", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("creates a standalone event profile and source-linked historical note without a booking or follow-up", async () => {
    const { client, service } = await harness();
    clients.push(client);
    const summary = await service.importBatch({ actorId: "owner", batchId, requestKey, now: new Date("2026-08-20T18:00:00Z") });

    expect(summary).toMatchObject({ profilesCreated: 1, historicalNotesCreated: 1, followUpsCreated: 0 });
    expect((await client.query(`select name, place_type, city, region from organizations`)).rows).toEqual([{
      name: "County Fair", place_type: "festival_event", city: "Minot", region: "ND",
    }]);
    expect((await client.query(`select count(*)::int as count from follow_ups`)).rows).toEqual([{ count: 0 }]);
    const activities = (await client.query(`select body, occurred_at, date_is_import_fallback, source_type, paper_note_entry_id from activities`)).rows;
    expect(activities[0]).toMatchObject({
      occurred_at: null,
      date_is_import_fallback: true,
      source_type: "paper_note",
      paper_note_entry_id: entryId,
    });
    expect(String(rowValue(activities, 0, "body"))).toContain("Original reminder: Call Monday. This was a historical reminder and was not added as a current task.");
    expect(String(rowValue(activities, 0, "body"))).toContain("Starred on original paper.");
  });

  it("returns the stored result on retry without duplicating CRM rows", async () => {
    const { client, service } = await harness();
    clients.push(client);
    const now = new Date("2026-08-20T18:00:00Z");
    const first = await service.importBatch({ actorId: "owner", batchId, requestKey, now });
    const second = await service.importBatch({ actorId: "owner", batchId, requestKey, now });
    expect(second).toEqual(first);
    expect((await client.query(`select count(*)::int as count from organizations`)).rows).toEqual([{ count: 1 }]);
    expect((await client.query(`select count(*)::int as count from activities`)).rows).toEqual([{ count: 1 }]);
  });

  it("rolls back the entire batch when a CRM write fails", async () => {
    const { client, service } = await harness();
    clients.push(client);
    await client.exec(`alter table activities add constraint reject_activity check (false);`);
    await expect(service.importBatch({ actorId: "owner", batchId, requestKey, now: new Date() })).rejects.toThrow();
    expect((await client.query(`select count(*)::int as count from organizations`)).rows).toEqual([{ count: 0 }]);
    expect((await client.query(`select status from paper_note_batches where id = $1`, [batchId])).rows).toEqual([{ status: "review" }]);
  });
});
