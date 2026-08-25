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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(batch_id, sheet_name, source_row_number),
      unique(batch_id, source_fingerprint)
    );
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
});
