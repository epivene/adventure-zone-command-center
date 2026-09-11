import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { reparentAdditionalOrganizationReferences } from "./organization-merge-additional-references";

const PRIMARY_ID = "10000000-0000-4000-8000-000000000001";
const DUPLICATE_ID = "10000000-0000-4000-8000-000000000002";
const CONNECTION_WITH_BOTH = "20000000-0000-4000-8000-000000000001";
const CONNECTION_TO_MOVE = "20000000-0000-4000-8000-000000000002";

let client: PGlite | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function createAdditionalReferenceTables(database: PGlite): Promise<void> {
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
    create table google_workspace_profile_labels (
      id uuid primary key default gen_random_uuid(),
      connection_id uuid not null,
      organization_id uuid not null,
      gmail_label_id text not null,
      updated_at timestamptz,
      unique (connection_id, organization_id),
      unique (connection_id, gmail_label_id)
    );
    create table google_workspace_gmail_mutations (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      updated_at timestamptz
    );
    create table google_workspace_gmail_thread_intents (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid,
      updated_at timestamptz
    );
  `);
}

describe("additional organization-reference merge compatibility", () => {
  it("reparents a convention card without requiring unrelated timestamp metadata", async () => {
    client = new PGlite();
    await createAdditionalReferenceTables(client);
    await client.exec(`
      insert into convention_members (organization_id)
      values ('10000000-0000-4000-8000-000000000002');
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

  it("reparents Google Workspace references and keeps the survivor label on a connection conflict", async () => {
    client = new PGlite();
    await createAdditionalReferenceTables(client);
    await client.exec(`
      insert into google_workspace_profile_labels
        (connection_id, organization_id, gmail_label_id)
      values
        ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Label_primary'),
        ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'Label_duplicate'),
        ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Label_move');
      insert into google_workspace_gmail_mutations (organization_id)
      values ('10000000-0000-4000-8000-000000000002');
      insert into google_workspace_gmail_thread_intents (organization_id)
      values ('10000000-0000-4000-8000-000000000002');
    `);

    await reparentAdditionalOrganizationReferences(
      drizzle(client) as any,
      PRIMARY_ID,
      DUPLICATE_ID,
    );

    const labels = await client.query<{
      connection_id: string;
      organization_id: string;
      gmail_label_id: string;
    }>(`
      select connection_id, organization_id, gmail_label_id
      from google_workspace_profile_labels
      order by connection_id
    `);
    expect(labels.rows).toEqual([
      {
        connection_id: CONNECTION_WITH_BOTH,
        organization_id: PRIMARY_ID,
        gmail_label_id: "Label_primary",
      },
      {
        connection_id: CONNECTION_TO_MOVE,
        organization_id: PRIMARY_ID,
        gmail_label_id: "Label_move",
      },
    ]);

    const mutations = await client.query<{ organization_id: string }>(
      "select organization_id from google_workspace_gmail_mutations",
    );
    expect(mutations.rows).toEqual([{ organization_id: PRIMARY_ID }]);

    const intents = await client.query<{ organization_id: string }>(
      "select organization_id from google_workspace_gmail_thread_intents",
    );
    expect(intents.rows).toEqual([{ organization_id: PRIMARY_ID }]);
  });
});
