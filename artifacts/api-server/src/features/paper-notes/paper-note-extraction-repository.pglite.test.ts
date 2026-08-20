import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { PaperNoteExtractionRepository } from "./paper-note-extraction-repository";
import type { PaperNoteExtraction, PaperNotePageSegmentation } from "./paper-note-extraction-schema";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";

async function setup() {
  const client = new PGlite();
  await client.exec(`
    create table paper_note_batches (
      id uuid primary key,
      name text,
      status text not null,
      created_by text not null,
      page_count integer not null default 0,
      import_request_key uuid,
      import_summary jsonb,
      failure_code text,
      failure_message text,
      extraction_started_at timestamptz,
      review_started_at timestamptz,
      import_started_at timestamptz,
      imported_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table paper_note_pages (
      id uuid primary key,
      batch_id uuid not null references paper_note_batches(id) on delete cascade,
      sort_order integer not null,
      original_filename text not null,
      mime_type text not null,
      size_bytes integer not null,
      width integer,
      height integer,
      rotation_degrees integer not null default 0,
      original_object_key text not null,
      analysis_object_key text,
      sha256 text,
      status text not null,
      current_stage text,
      page_heading text,
      page_activity_date date,
      page_context jsonb not null default '{}'::jsonb,
      rough_transcription text,
      attempt_count integer not null default 0,
      lease_token text,
      lease_expires_at timestamptz,
      last_error_code text,
      last_error_message text,
      extracted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table paper_note_entries (
      id uuid primary key default gen_random_uuid(),
      batch_id uuid not null references paper_note_batches(id) on delete cascade,
      page_id uuid not null references paper_note_pages(id) on delete cascade,
      source_order integer not null,
      source_region jsonb,
      extraction_payload jsonb not null,
      review_payload jsonb not null default '{}'::jsonb,
      review_version integer not null default 0,
      state text not null,
      destination_mode text,
      selected_organization_id uuid,
      selected_organization_location_id uuid,
      target_snapshot jsonb,
      validation_issues jsonb not null default '[]'::jsonb,
      approved_at timestamptz,
      imported_organization_id uuid,
      imported_organization_location_id uuid,
      imported_activity_id uuid,
      import_result jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into paper_note_batches (id, status, created_by, page_count)
    values ('${batchId}', 'queued', 'owner', 1);
    insert into paper_note_pages (
      id, batch_id, sort_order, original_filename, mime_type, size_bytes,
      original_object_key, status
    ) values (
      '${pageId}', '${batchId}', 0, 'page.png', 'image/png', 100,
      'paper-notes/${batchId}/${pageId}/original', 'queued'
    );
  `);
  const db = drizzle(client, { schema });
  return { client, repository: new PaperNoteExtractionRepository(db as never) };
}

const segmentation: PaperNotePageSegmentation = {
  pageHeading: "Phone Calls April 22, 2026",
  pageActivityDate: "2026-04-22",
  pageContext: ["call sheet"],
  roughTranscription: "Example Fair",
  entries: [{ sourceOrder: 0, region: null, roughText: "Example Fair", mayContinue: false }],
};

const extraction: PaperNoteExtraction = {
  source: "provider",
  transcription: "Example Fair",
  sourceRegion: null,
  mayContinue: false,
  event: { name: "Example Fair", city: null, region: null, venue: null },
  eventDates: [],
  activity: { rawDateText: null, occurredOn: "2026-04-22", dateSource: "page_heading", method: "call", outcome: null, summary: null },
  contacts: [],
  organizationPhones: [],
  oldReminder: null,
  starredOnPaper: false,
  generalNotes: [],
  warnings: [],
};

describe("PaperNoteExtractionRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("claims one queued page with a lease and increments attempts", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    const now = new Date("2026-08-20T20:00:00Z");

    const claimed = await repository.claimNextPage({ workerId: "worker-a", now, leaseMs: 300_000 });

    expect(claimed).toMatchObject({ batchId, pageId, attemptCount: 1 });
    expect(claimed?.leaseToken).toBeTruthy();
    expect((await client.query(`select status, attempt_count, lease_token from paper_note_pages where id='${pageId}'`)).rows[0])
      .toMatchObject({ status: "extracting", attempt_count: 1, lease_token: claimed?.leaseToken });
  });

  it("rejects completion from a stale lease token", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    const now = new Date("2026-08-20T20:00:00Z");
    await repository.claimNextPage({ workerId: "worker-a", now, leaseMs: 300_000 });

    await expect(repository.completePage({
      pageId,
      leaseToken: "stale-token",
      analysisObjectKey: `paper-notes/${batchId}/${pageId}/original`,
      segmentation,
      entries: [extraction],
      now,
    })).rejects.toMatchObject({ code: "STALE_LEASE" });
  });

  it("atomically stores entries and moves a fully resolved batch to review", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    const now = new Date("2026-08-20T20:00:00Z");
    const claimed = await repository.claimNextPage({ workerId: "worker-a", now, leaseMs: 300_000 });

    await repository.completePage({
      pageId,
      leaseToken: claimed!.leaseToken,
      analysisObjectKey: `paper-notes/${batchId}/${pageId}/original`,
      segmentation,
      entries: [extraction],
      now,
    });

    expect((await client.query(`select status, current_stage, lease_token from paper_note_pages where id='${pageId}'`)).rows)
      .toEqual([{ status: "extracted", current_stage: "complete", lease_token: null }]);
    expect((await client.query(`select state, extraction_payload from paper_note_entries where page_id='${pageId}'`)).rows[0])
      .toMatchObject({ state: "needs_review", extraction_payload: expect.objectContaining({ transcription: "Example Fair" }) });
    expect((await client.query(`select status from paper_note_batches where id='${batchId}'`)).rows)
      .toEqual([{ status: "review" }]);
  });
});
