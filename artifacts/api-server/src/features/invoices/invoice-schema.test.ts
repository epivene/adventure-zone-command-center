import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key default gen_random_uuid(), name text not null);
    create table bookings (id uuid primary key default gen_random_uuid());
    create table business_documents (
      id uuid primary key default gen_random_uuid(),
      category text not null default 'other',
      constraint business_documents_category_valid check (
        category in ('contract','proposal','coi','insurance_policy','w9_tax','permit','vendor_application','inspection','deposit_receipt','operational_template','marketing','other')
      )
    );
  `);
  const migration = await readFile(
    new URL("../../../../../lib/db/migrations/20260915_invoice_contract_tracking.sql", import.meta.url),
    "utf8",
  );
  await client.exec(migration);
  return client;
}

describe("invoice contract tracking migration", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("stores an invoice and append-only payment history", async () => {
    const client = await createDatabase();
    clients.push(client);
    const organizationId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    await client.query("insert into organizations (id, name) values ($1, 'Kamiah BBQ Days')", [organizationId]);
    await client.query("insert into business_documents (id, category) values ($1, 'invoice')", [documentId]);
    const invoice = await client.query<{ id: string }>(`
      insert into invoices (
        organization_id, document_id, invoice_number, status,
        currency, total_cents, deposit_cents, issue_date, created_by
      ) values ($1, $2, 'AZ-2027-001', 'sent', 'USD', 750000, 300000, '2026-09-15', 'owner:test')
      returning id
    `, [organizationId, documentId]);
    await client.query(`
      insert into invoice_payments (invoice_id, amount_cents, received_date, method, created_by)
      values ($1, 300000, '2026-09-15', 'check', 'owner:test')
    `, [invoice.rows[0]?.id]);

    expect((await client.query<{ count: number }>("select count(*)::int as count from invoice_payments")).rows[0]?.count).toBe(1);
  });

  it.each([-1, -100])("rejects negative payment %s", async (amountCents) => {
    const client = await createDatabase();
    clients.push(client);
    const organizationId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    await client.query("insert into organizations (id, name) values ($1, 'Test Event')", [organizationId]);
    await client.query("insert into business_documents (id, category) values ($1, 'invoice')", [documentId]);
    const invoice = await client.query<{ id: string }>(`
      insert into invoices (organization_id, document_id, invoice_number, total_cents, issue_date, created_by)
      values ($1, $2, 'TEST-1', 10000, '2026-09-15', 'owner:test') returning id
    `, [organizationId, documentId]);

    await expect(client.query(`
      insert into invoice_payments (invoice_id, amount_cents, received_date, method, created_by)
      values ($1, $2, '2026-09-15', 'check', 'owner:test')
    `, [invoice.rows[0]?.id, amountCents])).rejects.toThrow();
  });

  it("rejects deposits larger than the invoice total", async () => {
    const client = await createDatabase();
    clients.push(client);
    const organizationId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    await client.query("insert into organizations (id, name) values ($1, 'Test Event')", [organizationId]);
    await client.query("insert into business_documents (id, category) values ($1, 'invoice')", [documentId]);

    await expect(client.query(`
      insert into invoices (organization_id, document_id, invoice_number, total_cents, deposit_cents, issue_date, created_by)
      values ($1, $2, 'TEST-2', 10000, 10001, '2026-09-15', 'owner:test')
    `, [organizationId, documentId])).rejects.toThrow();
  });

  it("allows a cancelled invoice number to be reused but blocks two active duplicates", async () => {
    const client = await createDatabase();
    clients.push(client);
    const organizationId = crypto.randomUUID();
    const firstDocumentId = crypto.randomUUID();
    const secondDocumentId = crypto.randomUUID();
    await client.query("insert into organizations (id, name) values ($1, 'Test Event')", [organizationId]);
    await client.query("insert into business_documents (id, category) values ($1, 'invoice'), ($2, 'invoice')", [firstDocumentId, secondDocumentId]);
    await client.query(`
      insert into invoices (organization_id, document_id, invoice_number, status, total_cents, issue_date, created_by, cancelled_at)
      values ($1, $2, 'REUSE-1', 'cancelled', 10000, '2026-09-15', 'owner:test', now())
    `, [organizationId, firstDocumentId]);
    await expect(client.query(`
      insert into invoices (organization_id, document_id, invoice_number, total_cents, issue_date, created_by)
      values ($1, $2, 'REUSE-1', 10000, '2026-09-15', 'owner:test')
    `, [organizationId, secondDocumentId])).resolves.toBeDefined();
    await expect(client.query(`
      insert into invoices (organization_id, document_id, invoice_number, total_cents, issue_date, created_by)
      values ($1, gen_random_uuid(), 'REUSE-1', 10000, '2026-09-15', 'owner:test')
    `, [organizationId])).rejects.toThrow();
  });
});
