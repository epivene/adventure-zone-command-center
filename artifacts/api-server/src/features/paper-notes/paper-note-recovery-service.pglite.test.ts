import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { PaperNoteRecoveryRepository } from "./paper-note-recovery-repository";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";

async function setup() {
  const client = new PGlite();
  await client.exec(`
    create table paper_note_batches (
      id uuid primary key, name text, status text not null, created_by text not null,
      page_count integer not null default 0, import_request_key uuid, import_summary jsonb,
      failure_code text, failure_message text, extraction_started_at timestamptz,
      review_started_at timestamptz, import_started_at timestamptz, imported_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table paper_note_pages (
      id uuid primary key, batch_id uuid not null references paper_note_batches(id) on delete cascade,
      sort_order integer not null, original_filename text not null, mime_type text not null,
      size_bytes integer not null, width integer, height integer, rotation_degrees integer not null default 0,
      original_object_key text not null, analysis_object_key text, sha256 text, status text not null,
      current_stage text, page_heading text, page_activity_date date, page_context jsonb not null default '{}'::jsonb,
      rough_transcription text, attempt_count integer not null default 0, lease_token text,
      lease_expires_at timestamptz, last_error_code text, last_error_message text, extracted_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table paper_note_entries (
      id uuid primary key default gen_random_uuid(), batch_id uuid not null references paper_note_batches(id) on delete cascade,
      page_id uuid not null references paper_note_pages(id) on delete cascade, source_order integer not null,
      source_region jsonb, extraction_payload jsonb not null, review_payload jsonb not null default '{}'::jsonb,
      review_version integer not null default 0, state text not null, destination_mode text,
      selected_organization_id uuid, selected_organization_location_id uuid, target_snapshot jsonb,
      validation_issues jsonb not null default '[]'::jsonb, approved_at timestamptz,
      imported_organization_id uuid, imported_organization_location_id uuid, imported_activity_id uuid,
      import_result jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    insert into paper_note_batches (id, status, created_by, page_count)
    values ('${batchId}', 'review', 'owner', 1);
    insert into paper_note_pages (
      id, batch_id, sort_order, original_filename, mime_type, size_bytes, original_object_key,
      status, last_error_code, last_error_message
    ) values (
      '${pageId}', '${batchId}', 0, 'page.png', 'image/png', 100,
      'paper-notes/${batchId}/${pageId}/original', 'needs_retry', 'PROVIDER_UNAVAILABLE', 'AI reading is unavailable right now.'
    );
  `);
  const db = drizzle(client, { schema });
  return { client, repository: new PaperNoteRecoveryRepository(db as never) };
}

describe("PaperNoteRecoveryRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("queues only a retryable owner page and clears its safe error", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    await repository.retryPage("owner", batchId, pageId, new Date("2026-08-20T20:30:00Z"));
    expect((await client.query(`select status, last_error_code, lease_token from paper_note_pages where id='${pageId}'`)).rows)
      .toEqual([{ status: "queued", last_error_code: null, lease_token: null }]);
    expect((await client.query(`select status from paper_note_batches where id='${batchId}'`)).rows)
      .toEqual([{ status: "queued" }]);
  });

  it("creates a manual needs-review entry without inventing structured facts", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    await repository.addManualEntry(
      "owner",
      batchId,
      pageId,
      "Example Fair — number hard to read",
      new Date("2026-08-20T20:30:00Z"),
    );
    const row = (await client.query(`select state, extraction_payload from paper_note_entries where page_id='${pageId}'`)).rows[0] as any;
    expect(row.state).toBe("needs_review");
    expect(row.extraction_payload).toMatchObject({
      source: "manual",
      transcription: "Example Fair — number hard to read",
      event: { name: null },
      starredOnPaper: false,
    });
    expect((await client.query(`select status from paper_note_pages where id='${pageId}'`)).rows)
      .toEqual([{ status: "extracted" }]);
  });

  it("marks an empty failed page terminal without creating an entry", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    await repository.markReviewedEmpty("owner", batchId, pageId, new Date("2026-08-20T20:30:00Z"));
    expect((await client.query(`select status from paper_note_pages where id='${pageId}'`)).rows)
      .toEqual([{ status: "reviewed_empty" }]);
    expect((await client.query(`select count(*)::int as count from paper_note_entries`)).rows)
      .toEqual([{ count: 0 }]);
  });
  it("appends another manual entry while preserving an approved entry on the same photo", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    const now = new Date("2026-10-06T15:00:00Z");
    const firstId = await repository.addManualEntry("owner", batchId, pageId, "First Fair", now);
    await client.query(`update paper_note_entries set state='approved', review_payload='{"event":{"name":"First Fair"}}'::jsonb, review_version=3 where id=$1`, [firstId]);
    const secondId = await repository.addManualEntry("owner", batchId, pageId, "Second Fair", now);
    expect(secondId).not.toBe(firstId);
    const rows = (await client.query(`select source_order, state, review_payload, review_version, extraction_payload->>'transcription' as transcription from paper_note_entries order by source_order`)).rows;
    expect(rows).toEqual([
      { source_order: 0, state: "approved", review_payload: { event: { name: "First Fair" } }, review_version: 3, transcription: "First Fair" },
      { source_order: 1, state: "needs_review", review_payload: {}, review_version: 0, transcription: "Second Fair" },
    ]);
  });

  it.each(["queued", "extracting", "uploaded", "reviewed_empty"])("rejects manual append to a %s page", async (status) => {
    const { client, repository } = await setup();
    clients.push(client);
    await client.query(`update paper_note_pages set status=$1 where id=$2`, [status, pageId]);
    await expect(repository.addManualEntry("owner", batchId, pageId, "Fair", new Date())).rejects.toMatchObject({ code: "PAGE_NOT_EDITABLE" });
    expect((await client.query("select count(*)::int as count from paper_note_entries")).rows).toEqual([{ count: 0 }]);
  });

  it.each(["importing", "imported", "archived"])("keeps %s batches immutable", async (status) => {
    const { client, repository } = await setup();
    clients.push(client);
    await client.query(`update paper_note_batches set status=$1 where id=$2`, [status, batchId]);
    await expect(repository.addManualEntry("owner", batchId, pageId, "Fair", new Date())).rejects.toMatchObject({ code: "PAGE_NOT_EDITABLE" });
  });

});
