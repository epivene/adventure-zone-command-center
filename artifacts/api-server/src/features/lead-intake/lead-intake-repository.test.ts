import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { LeadIntakeRepository, sourceRowFingerprint } from "./lead-intake-repository";

async function setup() {
  const client = new PGlite();
  await client.exec(`
    create table lead_import_batches (
      id uuid primary key default gen_random_uuid(),
      original_filename text not null,
      file_sha256 text not null unique,
      status text not null default 'review',
      row_count integer not null,
      imported_by text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table lead_import_rows (
      id uuid primary key default gen_random_uuid(),
      batch_id uuid not null references lead_import_batches(id) on delete cascade,
      sheet_name text not null,
      source_row_number integer not null,
      source_fingerprint text not null,
      original_values jsonb not null,
      company text,
      phone text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      website text,
      industry text,
      warnings jsonb not null default '[]'::jsonb,
      state text not null default 'needs_review',
      review_version integer not null default 0,
      selected_organization_id uuid,
      selected_contact_id uuid,
      contact_mode text,
      confirmed_event_name text,
      confirmed_start_date date,
      confirmed_end_date date,
      confirmed_contact_name text,
      confirmed_contact_role text,
      confirmed_recipient_email text,
      recipient_confirmed boolean not null default false,
      introduction_suitable boolean not null default false,
      confirmed_by text,
      confirmed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(batch_id, sheet_name, source_row_number),
      unique(batch_id, source_fingerprint)
    );
    create table lead_import_evidence (
      id uuid primary key default gen_random_uuid(), row_id uuid not null references lead_import_rows(id) on delete cascade,
      field text not null, candidate_value text not null, source_kind text not null, source_reference text not null,
      selected boolean not null default false, created_by text not null, created_at timestamptz not null default now()
    );
    create unique index lead_import_evidence_one_selected_field
      on lead_import_evidence(row_id, field) where selected;
  `);
  const db = drizzle(client, { schema });
  return { client, repository: new LeadIntakeRepository(db as never) };
}

const fileSha256 = "a".repeat(64);
const row = {
  sheetName: "Sheet1",
  rowNumber: 2,
  company: "Aspen Filmfest",
  phone: null,
  address1: null,
  address2: null,
  city: "Aspen",
  state: "CO",
  zipCode: null,
  website: "aspenfilm.org",
  industry: null,
  originalValues: { Company: "Aspen Filmfest", City: "Aspen", State: "CO" },
};

describe("LeadIntakeRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("reuses an existing batch when the same workbook is imported twice", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    const input = { originalFilename: "Sept Week 3.xls", fileSha256, importedBy: "owner", rows: [row] };

    const first = await repository.importWorkbook(input, new Date("2026-08-25T12:00:00Z"));
    const second = await repository.importWorkbook(input, new Date("2026-08-25T12:01:00Z"));

    expect(first.reused).toBe(false);
    expect(second).toMatchObject({ batchId: first.batchId, reused: true, rowCount: 1 });
    expect((await client.query("select count(*)::int as count from lead_import_batches")).rows).toEqual([{ count: 1 }]);
    expect((await client.query("select count(*)::int as count from lead_import_rows")).rows).toEqual([{ count: 1 }]);
  }, 15_000);

  it("preserves incomplete rows and marks them for correction", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    await repository.importWorkbook({
      originalFilename: "Sept Week 4.xls",
      fileSha256: "b".repeat(64),
      importedBy: "owner",
      rows: [{ ...row, company: "", originalValues: { Company: null, City: "Aspen" } }],
    }, new Date("2026-08-25T12:00:00Z"));

    const result = await client.query("select company, state, warnings, original_values from lead_import_rows");
    expect(result.rows).toEqual([expect.objectContaining({
      company: null,
      state: "needs_correction",
      warnings: ["Company is missing."],
      original_values: { Company: null, City: "Aspen" },
    })]);
  }, 15_000);

  it("builds the same row fingerprint regardless of object key order", () => {
    expect(sourceRowFingerprint(fileSha256, row)).toBe(sourceRowFingerprint(fileSha256, {
      ...row,
      originalValues: { State: "CO", City: "Aspen", Company: "Aspen Filmfest" },
    }));
  });

  it("lists saved imports newest first so review work can be resumed", async () => {
    const { client, repository } = await setup();
    clients.push(client);
    await repository.importWorkbook({ originalFilename: "older.xls", fileSha256: "c".repeat(64), importedBy: "owner", rows: [row] }, new Date("2026-08-24T12:00:00Z"));
    await repository.importWorkbook({ originalFilename: "newer.xls", fileSha256: "d".repeat(64), importedBy: "owner", rows: [row] }, new Date("2026-08-25T12:00:00Z"));

    expect(await repository.listBatches()).toEqual([
      expect.objectContaining({ originalFilename: "newer.xls", rowCount: 1 }),
      expect.objectContaining({ originalFilename: "older.xls", rowCount: 1 }),
    ]);
  }, 15_000);

  it("returns selected evidence with each review row", async () => {
    const { client, repository } = await setup(); clients.push(client);
    const imported = await repository.importWorkbook({ originalFilename: "Week 3.xls", fileSha256: "e".repeat(64), importedBy: "owner", rows: [row] });
    const rowResult = await client.query<{ id: string }>("select id from lead_import_rows limit 1");
    await client.query("insert into lead_import_evidence(row_id, field, candidate_value, source_kind, source_reference, selected, created_by) values ($1, 'recipient_email', 'events@example.com', 'official_website', 'https://example.com/contact', true, 'owner')", [rowResult.rows[0]!.id]);

    const batch = await repository.getBatch(imported.batchId);
    expect(batch?.rows[0]).toEqual(expect.objectContaining({
      evidence: [expect.objectContaining({ field: "recipient_email", candidateValue: "events@example.com", selected: true })],
    }));
  }, 15_000);
});
