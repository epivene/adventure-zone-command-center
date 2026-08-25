import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { LeadReviewService, LeadReviewServiceError } from "./lead-review-service";

const rowId = "30000000-0000-4000-8000-000000000001";
const organizationId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";

async function setup() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key, consolidated_into_id uuid);
    create table contacts (id uuid primary key, email text);
    create table organization_contacts (
      organization_id uuid not null references organizations(id),
      contact_id uuid not null references contacts(id),
      active boolean not null default true,
      primary key (organization_id, contact_id)
    );
    create table lead_import_batches (
      id uuid primary key default gen_random_uuid(), original_filename text not null,
      file_sha256 text not null unique, status text not null, row_count integer not null,
      imported_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table lead_import_rows (
      id uuid primary key default gen_random_uuid(), batch_id uuid not null references lead_import_batches(id),
      sheet_name text not null, source_row_number integer not null, source_fingerprint text not null,
      original_values jsonb not null, company text, phone text, address_1 text, address_2 text,
      city text, region text, postal_code text, website text, industry text, warnings jsonb not null default '[]',
      state text not null, review_version integer not null default 0,
      selected_organization_id uuid references organizations(id), selected_contact_id uuid references contacts(id),
      contact_mode text, confirmed_event_name text, confirmed_start_date date, confirmed_end_date date,
      confirmed_contact_name text, confirmed_contact_role text, confirmed_recipient_email text,
      recipient_confirmed boolean not null default false, introduction_suitable boolean not null default false,
      confirmed_by text, confirmed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table lead_import_evidence (
      id uuid primary key default gen_random_uuid(), row_id uuid not null references lead_import_rows(id) on delete cascade,
      field text not null, candidate_value text not null, source_kind text not null, source_reference text not null,
      selected boolean not null default false, created_by text not null, created_at timestamptz not null default now()
    );
    alter table lead_import_rows add constraint lead_import_rows_confirmed_date_range_valid
      check (confirmed_start_date is null or confirmed_end_date is null or confirmed_end_date >= confirmed_start_date);
    create unique index lead_import_evidence_one_selected_field
      on lead_import_evidence(row_id, field) where selected;
    insert into organizations(id) values ('${organizationId}');
    insert into contacts(id, email) values ('${contactId}', 'lilupow@aspenfilm.org');
    insert into organization_contacts(organization_id, contact_id) values ('${organizationId}', '${contactId}');
    insert into lead_import_batches(id, original_filename, file_sha256, status, row_count, imported_by)
      values ('40000000-0000-4000-8000-000000000001', 'Week 3.xls', '${"a".repeat(64)}', 'review', 1, 'owner');
    insert into lead_import_rows(id, batch_id, sheet_name, source_row_number, source_fingerprint, original_values, company, state)
      values ('${rowId}', '40000000-0000-4000-8000-000000000001', 'CompanyList', 2, '${"b".repeat(64)}', '{}', 'Aspen Filmfest', 'needs_review');
  `);
  return { client, service: new LeadReviewService(drizzle(client, { schema }) as never) };
}

const decision = {
  organizationId,
  contactMode: "existing" as const,
  contactId,
  contactName: "Lindsey",
  contactRole: "Event organizer",
  recipientEmail: "lilupow@aspenfilm.org",
  recipientConfirmed: true,
  recipientConflictResolved: false,
  introductionSuitable: true,
  eventName: "Aspen Filmfest (Aspen) CO",
  startDate: "2026-09-29",
  endDate: "2026-10-04",
  emailEvidence: { sourceKind: "crm_contact" as const, sourceReference: `contact:${contactId}` },
  dateEvidence: { sourceKind: "official_website" as const, sourceReference: "https://aspenfilm.org/festival" },
};

describe("LeadReviewService", () => {
  const clients: PGlite[] = [];
  afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

  it("atomically verifies a row and retains selected email/date evidence", async () => {
    const { client, service } = await setup(); clients.push(client);
    await expect(service.confirm({ rowId, expectedVersion: 0, reviewedBy: "Desiree", decision }))
      .resolves.toEqual({ rowId, state: "verified", reviewVersion: 1 });

    expect((await client.query(`select state, review_version, confirmed_event_name, confirmed_recipient_email, confirmed_by from lead_import_rows where id='${rowId}'`)).rows)
      .toEqual([{ state: "verified", review_version: 1, confirmed_event_name: "Aspen Filmfest (Aspen) CO", confirmed_recipient_email: "lilupow@aspenfilm.org", confirmed_by: "Desiree" }]);
    expect((await client.query(`select field, source_kind, source_reference, selected from lead_import_evidence where row_id='${rowId}' order by field`)).rows)
      .toEqual([
        { field: "event_dates", source_kind: "official_website", source_reference: "https://aspenfilm.org/festival", selected: true },
        { field: "recipient_email", source_kind: "crm_contact", source_reference: `contact:${contactId}`, selected: true },
      ]);
  }, 15_000);

  it("rejects a stale browser version without overwriting the first review", async () => {
    const { client, service } = await setup(); clients.push(client);
    await service.confirm({ rowId, expectedVersion: 0, reviewedBy: "Desiree", decision });
    await expect(service.confirm({ rowId, expectedVersion: 0, reviewedBy: "Amy", decision: { ...decision, recipientEmail: "other@aspenfilm.org" } }))
      .rejects.toMatchObject<Partial<LeadReviewServiceError>>({ code: "VERSION_CONFLICT" });
  }, 15_000);

  it("does not verify a contact attached to another profile", async () => {
    const { client, service } = await setup(); clients.push(client);
    await client.exec(`delete from organization_contacts`);
    await expect(service.confirm({ rowId, expectedVersion: 0, reviewedBy: "Desiree", decision }))
      .rejects.toMatchObject<Partial<LeadReviewServiceError>>({ code: "REVIEW_BLOCKED" });
    expect((await client.query(`select state from lead_import_rows where id='${rowId}'`)).rows).toEqual([{ state: "needs_review" }]);
  }, 15_000);

  it("does not trust a recipient that differs from the selected existing contact", async () => {
    const { client, service } = await setup(); clients.push(client);
    await expect(service.confirm({
      rowId,
      expectedVersion: 0,
      reviewedBy: "Desiree",
      decision: { ...decision, recipientEmail: "other@aspenfilm.org" },
    })).rejects.toMatchObject<Partial<LeadReviewServiceError>>({ code: "REVIEW_BLOCKED" });
  }, 15_000);

  it("derives conflicting profile emails on the server and requires an explicit manual override", async () => {
    const { client, service } = await setup(); clients.push(client);
    const secondContact = "20000000-0000-4000-8000-000000000002";
    await client.exec(`
      insert into contacts(id, email) values ('${secondContact}', 'events@aspenfilm.org');
      insert into organization_contacts(organization_id, contact_id) values ('${organizationId}', '${secondContact}');
    `);
    const manual = {
      ...decision,
      contactMode: "manual" as const,
      contactId: null,
      recipientEmail: "director@aspenfilm.org",
      emailEvidence: { sourceKind: "official_website" as const, sourceReference: "https://aspenfilm.org/contact" },
    };
    await expect(service.confirm({ rowId, expectedVersion: 0, reviewedBy: "Desiree", decision: manual }))
      .rejects.toMatchObject<Partial<LeadReviewServiceError>>({ code: "REVIEW_BLOCKED" });
    await expect(service.confirm({ rowId, expectedVersion: 0, reviewedBy: "Desiree", decision: { ...manual, recipientConflictResolved: true } }))
      .resolves.toMatchObject({ state: "verified" });
  }, 15_000);

  it("rolls back the row update if storing evidence fails", async () => {
    const { client, service } = await setup(); clients.push(client);
    await client.exec(`
      create unique index force_evidence_failure on lead_import_evidence(row_id, source_reference);
      insert into lead_import_evidence(row_id, field, candidate_value, source_kind, source_reference, selected, created_by)
      values ('${rowId}', 'recipient_email', 'old@example.com', 'manual', 'https://aspenfilm.org/festival', false, 'owner');
    `);
    await expect(service.confirm({ rowId, expectedVersion: 0, reviewedBy: "Desiree", decision })).rejects.toBeTruthy();
    expect((await client.query(`select state, review_version from lead_import_rows where id='${rowId}'`)).rows)
      .toEqual([{ state: "needs_review", review_version: 0 }]);
  }, 15_000);
});
