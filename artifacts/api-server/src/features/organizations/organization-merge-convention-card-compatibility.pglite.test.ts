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

describe("RMAF convention-card merge compatibility", () => {
  it("reparents a convention card without requiring unrelated timestamp metadata", async () => {
    client = new PGlite();
    await client.exec(`
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
      create table organization_phones (organization_id uuid, updated_at timestamptz);
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
      insert into convention_members (organization_id) values ('10000000-0000-4000-8000-000000000002');
    `);

    await reparentAdditionalOrganizationReferences(
      drizzle(client) as any,
      PRIMARY_ID,
      DUPLICATE_ID,
    );

    const moved = await client.query<{ organization_id: string }>(
      "select organization_id from convention_members",
    );
    expect(moved.rows).toEqual([{ organization_id: PRIMARY_ID }]);
  });
});
