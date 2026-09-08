import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { CoiDraftService, DrizzleCoiDraftPersistence } from "./coi-draft-service";
import { guaranteedFeeSnapshot } from "./fixtures/guaranteed-fee.snapshot";

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((database) => database.close())); });

async function setup() {
  const client = new PGlite();
  databases.push(client);
  await client.exec(`
    create type booking_status as enum ('new_lead','researching','contact_due','contacted','interested','possible','unlikely','quote_sent','pending_decision','pending_contract','contract_received','confirmed','declined','cancelled','completed','renewal_due');
    create table organizations (id uuid primary key);
    create table bookings (id uuid primary key, organization_id uuid references organizations(id), status booking_status not null default 'new_lead');
  `);
  const migration = await readFile(fileURLToPath(new URL("../../../../../lib/db/migrations/20260908_contract_builder.sql", import.meta.url)), "utf8");
  await client.exec(migration);
  await client.exec(`
    insert into organizations values ('11111111-1111-4111-8111-111111111111');
    insert into bookings values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','contract_received');
    insert into contract_templates (id, stable_key, version, state, created_by) values ('33333333-3333-4333-8333-333333333333','adventure-zone-standard',1,'active','owner');
    insert into contract_drafts (id, booking_id, organization_id, template_id, last_edited_by, finalized_at) values ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','owner',now());
  `);
  await client.query(`insert into contract_versions (id, booking_id, organization_id, template_id, draft_id, version_number, status, snapshot, rendered_legal_text, signer_snapshot, created_by) values ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',1,'completed',$1::jsonb,'agreement','[]','owner')`, [JSON.stringify({ values: guaranteedFeeSnapshot, insuranceRecipient: { name: "Sara Toone", email: "sara@protectiveins.net" }, template: { stableKey: "adventure-zone-standard", version: 1 }, finalizedAt: "2026-09-08T18:00:00Z" })]);
  return client;
}

describe("COI draft persistence", () => {
  it("reserves and persists exactly one created Gmail draft", async () => {
    const client = await setup();
    let calls = 0;
    const service = new CoiDraftService({
      persistence: new DrizzleCoiDraftPersistence(drizzle(client) as never),
      provider: { createDraft: async () => { calls += 1; return { connectionId: "99999999-9999-4999-8999-999999999999", draftId: "gmail-draft-1", messageId: "gmail-message-1" }; } },
      now: () => new Date("2026-09-08T20:00:00Z"),
    });
    const input = { contractVersionId: "55555555-5555-4555-8555-555555555555", actorId: "owner" };
    await service.createOrRecover(input);
    await service.createOrRecover(input);
    expect(calls).toBe(1);
    const rows = await client.query<{ state: string; recipient_email: string; gmail_draft_id: string }>("select state, recipient_email, gmail_draft_id from contract_coi_drafts");
    expect(rows.rows).toEqual([{ state: "created", recipient_email: "sara@protectiveins.net", gmail_draft_id: "gmail-draft-1" }]);
  });
});
