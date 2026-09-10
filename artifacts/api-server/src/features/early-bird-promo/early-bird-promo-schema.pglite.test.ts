import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../lib/db/migrations/20260909_early_bird_promo.sql",
);

async function createExistingTables(client: PGlite) {
  await client.exec(`
    create table organizations (id uuid primary key);
    create table contacts (id uuid primary key);
    create table bookings (id uuid primary key);
    create table follow_ups (id uuid primary key);
    create table office_accounts (id uuid primary key);
    create table communication_templates (id uuid primary key);
    create table commercial_offer_rules (id uuid primary key);
    create table booking_opportunities (id uuid primary key);
    create table office_email_drafts (
      id uuid primary key default gen_random_uuid(),
      office_account_id uuid not null references office_accounts(id) on delete restrict,
      organization_id uuid not null references organizations(id) on delete restrict,
      contact_id uuid not null references contacts(id) on delete restrict,
      communication_template_id uuid references communication_templates(id) on delete set null,
      recipient_email text not null,
      subject text not null,
      body text not null,
      state text not null default 'draft',
      constraint office_email_drafts_state_valid
        check (state in ('draft','submitted','needs_changes','sending','sent'))
    );
  `);
}

describe("Early Bird Promo migration", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("adds an idempotent enrollment model and cancellable system drafts", async () => {
    const client = new PGlite();
    clients.push(client);
    await createExistingTables(client);
    const migration = await readFile(migrationPath, "utf8");

    await client.exec(migration);
    await client.exec(migration);
    await client.exec(`
      insert into organizations values ('10000000-0000-4000-8000-000000000001');
      insert into organizations values ('10000000-0000-4000-8000-000000000002');
      insert into contacts values ('20000000-0000-4000-8000-000000000001');
      insert into commercial_offer_rules values ('30000000-0000-4000-8000-000000000001');
      insert into early_bird_promo_enrollments (
        commercial_offer_rule_id, organization_id, event_year, source_kind,
        first_email_record_id, first_sent_at, deadline_date, expires_at
      ) values (
        '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', 2027, 'office_email',
        '40000000-0000-4000-8000-000000000001',
        '2026-09-10T15:00:00Z', '2026-10-10', '2026-10-11T05:00:00Z'
      );
      insert into office_email_drafts (
        office_account_id, organization_id, contact_id, recipient_email,
        subject, body, state, event_year
      ) values (
        null, '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001', 'person@example.com',
        'Reminder', 'Body', 'cancelled', 2027
      );
    `);

    await expect(client.exec(`
      insert into early_bird_promo_enrollments (
        commercial_offer_rule_id, organization_id, event_year, source_kind,
        first_email_record_id, first_sent_at, deadline_date, expires_at
      ) values (
        '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001', 2027, 'office_email',
        '50000000-0000-4000-8000-000000000001',
        '2026-09-11T15:00:00Z', '2026-10-11', '2026-10-12T05:00:00Z'
      );
    `)).rejects.toThrow();

    await expect(client.exec(`
      insert into early_bird_promo_enrollments (
        commercial_offer_rule_id, organization_id, event_year, source_kind,
        first_email_record_id, first_sent_at, deadline_date, expires_at
      ) values (
        '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002', 2027, 'office_email',
        '60000000-0000-4000-8000-000000000001',
        '2026-09-10T15:00:00Z', '2026-10-10', '2026-09-10T15:00:00Z'
      );
    `)).rejects.toThrow();
  }, 20_000);
});
