import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { reparentAdditionalOrganizationReferences } from "./organization-merge-additional-references";

const PRIMARY_ID = "10000000-0000-4000-8000-000000000001";
const DUPLICATE_ID = "10000000-0000-4000-8000-000000000002";

let client: PGlite | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function createReferenceTables(database: PGlite): Promise<void> {
  await database.exec(`
    create table office_tasks (organization_id uuid, updated_at timestamptz);
    create table office_mail_activity (organization_id uuid, updated_at timestamptz);
    create table office_email_drafts (organization_id uuid, updated_at timestamptz);
    create table lead_import_rows (selected_organization_id uuid, updated_at timestamptz);
    create table lead_gmail_draft_links (organization_id uuid, updated_at timestamptz);
    create table communication_blocks (
      id uuid primary key default gen_random_uuid(),
      target_type text,
      organization_id uuid,
      active boolean
    );
    create table communication_block_events (block_id uuid);
    create table paper_note_entries (
      selected_organization_id uuid,
      imported_organization_id uuid,
      updated_at timestamptz
    );
    create table organization_phones (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      organization_location_id uuid,
      number text not null,
      normalized_number text,
      normalized_extension text,
      "primary" boolean not null default false,
      status text not null default 'active',
      updated_at timestamptz
    );
    create unique index organization_phones_general_destination_unique
      on organization_phones(organization_id, normalized_number, coalesce(normalized_extension, ''))
      where organization_location_id is null and normalized_number is not null;
    create unique index organization_phones_one_active_primary_general
      on organization_phones(organization_id)
      where organization_location_id is null and "primary" and status = 'active';
    create table event_attendance_history (organization_id uuid);
    create table business_source_document_links (
      source_document_id uuid,
      organization_id uuid
    );
    create table convention_members (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid
    );
    create table booking_opportunities (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid,
      event_year integer,
      updated_at timestamptz
    );
    create table booking_opportunity_email_state (
      opportunity_id uuid,
      organization_id uuid,
      event_year integer,
      state text,
      updated_at timestamptz
    );
    create table booking_opportunity_queue_overrides (
      opportunity_id uuid,
      business_date date,
      pinned boolean,
      manual_order integer,
      snoozed_until timestamptz,
      created_at timestamptz,
      updated_at timestamptz,
      unique (opportunity_id, business_date)
    );
  `);
}

describe("organization phone merge references", () => {
  it("deduplicates matching phones and keeps only the survivor primary", async () => {
    client = new PGlite();
    await createReferenceTables(client);
    await client.exec(`
      insert into organization_phones
        (organization_id, number, normalized_number, "primary", status)
      values
        ('${PRIMARY_ID}', '406-665-9700', '4066659700', true, 'active'),
        ('${DUPLICATE_ID}', '(406) 665-9700', '4066659700', false, 'active'),
        ('${DUPLICATE_ID}', '406-679-3582', '4066793582', true, 'active');
    `);

    await reparentAdditionalOrganizationReferences(
      drizzle(client) as any,
      PRIMARY_ID,
      DUPLICATE_ID,
    );

    const phones = await client.query<{
      organization_id: string;
      normalized_number: string;
      primary: boolean;
    }>(`
      select organization_id, normalized_number, "primary" as primary
      from organization_phones
      order by normalized_number
    `);

    expect(phones.rows).toEqual([
      {
        organization_id: PRIMARY_ID,
        normalized_number: "4066659700",
        primary: true,
      },
      {
        organization_id: PRIMARY_ID,
        normalized_number: "4066793582",
        primary: false,
      },
    ]);
  });
});
