import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { PaperNoteIntakeRepository } from "./paper-note-intake-repository";

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
      sort_order integer not null check (sort_order >= 0),
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
      updated_at timestamptz not null default now(),
      unique(batch_id, sort_order)
    );
  `);
  const db = drizzle(client, { schema });
  return { client, repository: new PaperNoteIntakeRepository(db as never) };
}

const ownerBatch = "10000000-0000-4000-8000-000000000001";
const otherBatch = "10000000-0000-4000-8000-000000000002";
const firstPage = "20000000-0000-4000-8000-000000000001";
const secondPage = "20000000-0000-4000-8000-000000000002";
const otherPage = "20000000-0000-4000-8000-000000000003";

async function seed(client: PGlite) {
  await client.exec(`
    insert into paper_note_batches (id, status, created_by, page_count)
    values
      ('${ownerBatch}', 'draft', 'owner', 2),
      ('${otherBatch}', 'draft', 'someone-else', 1);
    insert into paper_note_pages (
      id, batch_id, sort_order, original_filename, mime_type, size_bytes,
      rotation_degrees, original_object_key, status
    ) values
      ('${firstPage}', '${ownerBatch}', 0, 'first.png', 'image/png', 10, 0, 'one', 'uploaded'),
      ('${secondPage}', '${ownerBatch}', 1, 'second.png', 'image/png', 10, 0, 'two', 'uploaded'),
      ('${otherPage}', '${otherBatch}', 0, 'other.png', 'image/png', 10, 0, 'three', 'uploaded');
  `);
}

describe("PaperNoteIntakeRepository mutation guards", () => {
  const clients: PGlite[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("reorders pages without ever using a negative sort order", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    await seed(client);

    await expect(repository.reorderDraftPages(
      "owner",
      ownerBatch,
      [secondPage, firstPage],
      new Date("2026-08-20T19:30:00Z"),
    )).resolves.toBeUndefined();

    expect((await client.query(`
      select id, sort_order from paper_note_pages
      where batch_id = '${ownerBatch}'
      order by sort_order
    `)).rows).toEqual([
      { id: secondPage, sort_order: 0 },
      { id: firstPage, sort_order: 1 },
    ]);
  });

  it("checks ownership before changing page rotation", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    await seed(client);

    await expect(repository.setDraftPageRotation(
      "owner",
      otherBatch,
      otherPage,
      90,
      new Date("2026-08-20T19:30:00Z"),
    )).rejects.toMatchObject({ code: "BATCH_NOT_FOUND" });

    expect((await client.query(`
      select rotation_degrees from paper_note_pages where id = '${otherPage}'
    `)).rows).toEqual([{ rotation_degrees: 0 }]);
  });
});
