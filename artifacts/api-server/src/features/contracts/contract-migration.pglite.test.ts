import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { loadActReviewMigrations } from "@workspace/db/migrations";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("contract builder migration", () => {
  it("is included in the production startup migration set", async () => {
    const migrations = await loadActReviewMigrations();

    expect(migrations.map(({ name }) => name)).toContain("20260908_contract_builder.sql");
  });

  it("creates defaults and prevents duplicate open drafts and COI requests", async () => {
    const database = new PGlite();
    databases.push(database);
    await database.exec(`
      create table organizations (id uuid primary key);
      create table bookings (id uuid primary key, organization_id uuid references organizations(id));
    `);
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/20260908_contract_builder.sql", import.meta.url)),
      "utf8",
    );
    await database.exec(migration);
    await database.exec(migration);

    const settings = await database.query<{
      internal_signer_name: string;
      internal_signer_order: number;
      insurance_recipient_name: string;
      insurance_recipient_email: string;
    }>(`select internal_signer_name, internal_signer_order, insurance_recipient_name, insurance_recipient_email from contract_settings`);
    expect(settings.rows).toEqual([{
      internal_signer_name: "Dave Gordon",
      internal_signer_order: 2,
      insurance_recipient_name: "Sara Toone",
      insurance_recipient_email: "sara@protectiveins.net",
    }]);

    await database.exec(`
      insert into organizations values ('11111111-1111-4111-8111-111111111111');
      insert into bookings values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
      insert into contract_templates (id, stable_key, version, state, created_by)
      values ('33333333-3333-4333-8333-333333333333', 'adventure-zone-standard', 1, 'reviewed', 'owner');
      insert into contract_drafts (id, booking_id, organization_id, template_id, last_edited_by)
      values ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'owner');
    `);

    await expect(database.exec(`
      insert into contract_drafts (booking_id, organization_id, template_id, last_edited_by)
      values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'owner');
    `)).rejects.toThrow();

    await database.exec(`
      update contract_drafts set finalized_at = now() where id = '44444444-4444-4444-8444-444444444444';
      insert into contract_versions (
        id, booking_id, organization_id, template_id, draft_id, version_number,
        snapshot, rendered_legal_text, signer_snapshot, created_by
      ) values (
        '55555555-5555-4555-8555-555555555555',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        1, '{}'::jsonb, 'Agreement', '[]'::jsonb, 'owner'
      );
      insert into contract_coi_drafts (
        contract_version_id, recipient_name, recipient_email, subject, body, state, idempotency_key
      ) values (
        '55555555-5555-4555-8555-555555555555', 'Sara Toone', 'sara@protectiveins.net',
        'COI Request', 'Please prepare the attached COI.', 'prepared', 'contract-coi:55555555-5555-4555-8555-555555555555'
      );
    `);

    await expect(database.exec(`
      insert into contract_coi_drafts (
        contract_version_id, recipient_name, recipient_email, subject, body, state, idempotency_key
      ) values (
        '55555555-5555-4555-8555-555555555555', 'Sara Toone', 'sara@protectiveins.net',
        'Duplicate', 'Duplicate', 'prepared', 'contract-coi:55555555-5555-4555-8555-555555555555'
      );
    `)).rejects.toThrow();
  });
});
