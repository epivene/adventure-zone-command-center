import { PGlite } from "@electric-sql/pglite";

function rowValue(row: unknown, key: string): unknown {
  return row && typeof row === "object" && !Array.isArray(row) && key in row
    ? (row as Record<string, unknown>)[key]
    : undefined;
}
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

import { APPROVED_LEAD_INTRODUCTION_2026 } from "./lead-introduction-2026-approved";
import { CommunicationTemplateRepository } from "./communication-template-repository";
import {
  ensureCommunicationTemplateSeed,
  getApprovedCommunicationTemplateSeedIssues,
  isApprovedCommunicationTemplateSeedReady,
} from "./communication-template-seed";

const sourceId = "50000000-0000-4000-8000-000000000001";
const seed = {
  code: APPROVED_LEAD_INTRODUCTION_2026.code,
  templateVersion: APPROVED_LEAD_INTRODUCTION_2026.version,
  name: APPROVED_LEAD_INTRODUCTION_2026.name,
  channel: "email" as const,
  category: "lead_introduction",
  accessScope: "office" as const,
  state: "active" as const,
  subjectTemplate: APPROVED_LEAD_INTRODUCTION_2026.subject,
  requiredPlaceholders: ["eventName", "eventDates"] as const,
  bodyTemplate: APPROVED_LEAD_INTRODUCTION_2026.bodyTemplate,
  sourceNote: APPROVED_LEAD_INTRODUCTION_2026.sourceNote,
  reviewedBy: APPROVED_LEAD_INTRODUCTION_2026.reviewedBy,
};

async function createTemplateTables(client: PGlite, withVersion: boolean) {
  await client.exec(`
    create table business_source_documents (
      id uuid primary key default gen_random_uuid(), original_filename text not null,
      display_title text not null, source_category text not null, effective_year integer,
      access_scope text not null, review_state text not null, storage_reference text,
      notes text, reviewed_by text, reviewed_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table communication_templates (
      id uuid primary key default gen_random_uuid(), code text not null unique
      ${withVersion ? ", template_version text" : ""}, name text not null,
      channel text not null, category text not null, subject_template text, body_template text not null,
      allowed_placeholders text[] not null default '{}', required_placeholders text[] not null default '{}',
      access_scope text not null, state text not null, owner_kind text not null,
      owner_office_account_id uuid, created_by_kind text not null, created_by_id uuid,
      source_template_id uuid, source_document_id uuid, source_note text, reviewed_by text,
      reviewed_at timestamptz, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into business_source_documents (
      id, original_filename, display_title, source_category, effective_year,
      access_scope, review_state, storage_reference, notes, reviewed_by, reviewed_at
    ) values (
      '${sourceId}', '${APPROVED_LEAD_INTRODUCTION_2026.sourceFilename}',
      '${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.displayTitle}',
      '${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.category}',
      ${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.effectiveYear},
      '${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.accessScope}',
      '${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.reviewState}',
      '${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.storageReference}',
      '${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.notes.replaceAll("'", "''")}',
      '${APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.reviewedBy}',
      '2026-08-25T00:00:00Z'
    );
  `);
}

describe("approved communication-template startup", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("verifies the exact approved seed after controlled schema readiness", async () => {
    const client = new PGlite(); clients.push(client);
    await createTemplateTables(client, true);
    const db = drizzle(client, { schema });

    await expect(isApprovedCommunicationTemplateSeedReady(db as never)).resolves.toBe(false);
    await ensureCommunicationTemplateSeed(db as never, { ensureSourceSeed: async () => undefined });
    await expect(isApprovedCommunicationTemplateSeedReady(db as never)).resolves.toBe(true);
  }, 20_000);

  it("repairs legacy system-owned source provenance and is a no-op on restart", async () => {
    const client = new PGlite(); clients.push(client);
    await createTemplateTables(client, true);
    await client.exec(`
      update business_source_documents
      set storage_reference = null, updated_at = '2026-01-02T03:04:05Z'
      where id = '${sourceId}'
    `);
    const db = drizzle(client, { schema });

    await expect(getApprovedCommunicationTemplateSeedIssues(db as never))
      .resolves.toEqual(["templateRecord"]);
    await ensureCommunicationTemplateSeed(db as never, { ensureSourceSeed: async () => undefined });
    await expect(isApprovedCommunicationTemplateSeedReady(db as never)).resolves.toBe(true);
    const repaired = (await client.query(`
      select storage_reference, reviewed_at, updated_at
      from business_source_documents where id = '${sourceId}'
    `)).rows[0];
    expect(repaired).toMatchObject({
      storage_reference: APPROVED_LEAD_INTRODUCTION_2026.sourceDocument.storageReference,
      reviewed_at: new Date("2026-08-25T00:00:00Z"),
    });
    expect(rowValue(repaired, "updated_at")).not.toEqual(new Date("2026-01-02T03:04:05Z"));

    await ensureCommunicationTemplateSeed(db as never, { ensureSourceSeed: async () => undefined });
    const restarted = (await client.query(`
      select storage_reference, reviewed_at, updated_at
      from business_source_documents where id = '${sourceId}'
    `)).rows[0];
    expect(restarted).toEqual(repaired);
  }, 20_000);

  it("does not rewrite a source record that is no longer the known system seed", async () => {
    const client = new PGlite(); clients.push(client);
    await createTemplateTables(client, true);
    await client.exec(`
      update business_source_documents
      set storage_reference = null, reviewed_by = 'amy'
      where id = '${sourceId}'
    `);
    const db = drizzle(client, { schema });

    await ensureCommunicationTemplateSeed(db as never, { ensureSourceSeed: async () => undefined });

    expect((await client.query(`select storage_reference, reviewed_by from business_source_documents where id = '${sourceId}'`)).rows)
      .toEqual([{ storage_reference: null, reviewed_by: "amy" }]);
    await expect(getApprovedCommunicationTemplateSeedIssues(db as never))
      .resolves.toEqual(["sourceStorageReference"]);
  }, 20_000);

  it("handles concurrent first seed attempts atomically", async () => {
    const client = new PGlite(); clients.push(client);
    await createTemplateTables(client, true);
    const db = drizzle(client, { schema });
    const first = new CommunicationTemplateRepository(db as never);
    const second = new CommunicationTemplateRepository(db as never);

    await expect(Promise.all([
      first.seed([seed], sourceId),
      second.seed([seed], sourceId),
    ])).resolves.toEqual([undefined, undefined]);
    expect((await client.query(`select count(*)::int as count from communication_templates where code = '${seed.code}'`)).rows)
      .toEqual([{ count: 1 }]);
  }, 20_000);

  it("makes an exact re-seed a true no-op that preserves approval provenance", async () => {
    const client = new PGlite(); clients.push(client);
    await createTemplateTables(client, true);
    const db = drizzle(client, { schema });
    const repository = new CommunicationTemplateRepository(db as never);
    await repository.seed([seed], sourceId);
    await client.exec(`update communication_templates set reviewed_at = '2026-01-02T03:04:05Z', updated_at = '2026-01-02T03:04:05Z' where code = '${seed.code}'`);
    const before = (await client.query(`select reviewed_by, reviewed_at, updated_at from communication_templates where code = '${seed.code}'`)).rows[0];

    await repository.seed([seed], sourceId);

    const after = (await client.query(`select reviewed_by, reviewed_at, updated_at from communication_templates where code = '${seed.code}'`)).rows[0];
    expect(after).toEqual(before);
  }, 20_000);
});
