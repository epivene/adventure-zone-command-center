import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  PaperNoteReviewRepository,
  PaperNoteReviewRepositoryError,
} from "./paper-note-review-repository";

const batchId = "10000000-0000-4000-8000-000000000001";
const pageId = "20000000-0000-4000-8000-000000000001";
const entryId = "30000000-0000-4000-8000-000000000001";

async function harness() {
  const client = new PGlite();
  await client.exec(`
    create table paper_note_batches (
      id uuid primary key,
      created_by text not null,
      status text not null default 'review'
    );
    create table paper_note_pages (
      id uuid primary key,
      batch_id uuid not null references paper_note_batches(id)
    );
    create table paper_note_entries (
      id uuid primary key,
      batch_id uuid not null references paper_note_batches(id),
      page_id uuid not null references paper_note_pages(id),
      extraction_payload jsonb not null,
      review_payload jsonb not null default '{}'::jsonb,
      review_version integer not null default 0,
      state text not null default 'needs_review',
      target_snapshot jsonb,
      validation_issues jsonb not null default '[]'::jsonb,
      approved_at timestamptz,
      updated_at timestamptz not null default now()
    );
  `);
  await client.query(`insert into paper_note_batches(id, created_by) values($1, 'owner')`, [batchId]);
  await client.query(`insert into paper_note_pages(id, batch_id) values($1, $2)`, [pageId, batchId]);
  await client.query(`
    insert into paper_note_entries(id, batch_id, page_id, extraction_payload)
    values($1, $2, $3, $4::jsonb)
  `, [entryId, batchId, pageId, JSON.stringify({
    source: "provider",
    transcription: "Emmett Cherry Festival",
    sourceRegion: null,
    mayContinue: false,
    event: { name: "Emmett Cherry Festival", city: "Emmett", region: "ID", venue: null },
    eventDates: [],
    activity: { rawDateText: null, occurredOn: null, dateSource: "unknown", method: "call", outcome: null, summary: null },
    contacts: [],
    organizationPhones: [],
    oldReminder: "Call Monday",
    starredOnPaper: true,
    generalNotes: [],
    warnings: [],
  })]);
  const db = drizzle(client, { schema });
  return { client, repository: new PaperNoteReviewRepository(db as never) };
}

describe("PaperNoteReviewRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("derives an editable draft from immutable extraction when review is still empty", async () => {
    const { client, repository } = await harness();
    clients.push(client);
    const entry = await repository.getForReview("owner", entryId);
    expect(entry?.review.event.name).toBe("Emmett Cherry Festival");
    expect(entry?.review.destination).toBeNull();
    expect(entry?.review.oldReminder).toBe("Call Monday");
  });

  it("increments the review version atomically and rejects a stale writer", async () => {
    const { client, repository } = await harness();
    clients.push(client);
    const current = await repository.getForReview("owner", entryId);
    if (!current) throw new Error("missing entry");
    const review = { ...current.review, destination: { mode: "new_profile", eventFamilyId: null } as const };

    const saved = await repository.saveReview({
      actorId: "owner",
      entryId,
      expectedVersion: 0,
      review,
      state: "ready",
      validationIssues: [],
      approvedAt: null,
      now: new Date("2026-08-20T18:00:00Z"),
    });
    expect(saved.reviewVersion).toBe(1);
    expect(saved.state).toBe("ready");
    const snapshot = await client.query<{ target_snapshot: unknown }>(
      `select target_snapshot from paper_note_entries where id = $1`,
      [entryId],
    );
    expect(snapshot.rows[0]?.target_snapshot).toBeNull();

    await expect(repository.saveReview({
      actorId: "owner",
      entryId,
      expectedVersion: 0,
      review,
      state: "ready",
      validationIssues: [],
      approvedAt: null,
      now: new Date("2026-08-20T18:01:00Z"),
    })).rejects.toMatchObject({ code: "STALE_REVIEW_VERSION" } satisfies Partial<PaperNoteReviewRepositoryError>);
  });
});
