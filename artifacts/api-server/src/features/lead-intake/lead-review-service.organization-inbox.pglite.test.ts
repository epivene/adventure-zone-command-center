import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { expect, it } from "vitest";

import * as schema from "@/db/schema";
import { LeadReviewService } from "./lead-review-service";

it("stores an organization inbox without synthetic person fields", async () => {
  const client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key, consolidated_into_id uuid);
    create table contacts (id uuid primary key, email text);
    create table organization_contacts (organization_id uuid, contact_id uuid, active boolean not null);
    create table lead_import_rows (
      id uuid primary key, review_version integer not null, state text not null,
      selected_organization_id uuid, selected_contact_id uuid, contact_mode text,
      confirmed_event_name text, confirmed_start_date date, confirmed_end_date date,
      confirmed_contact_name text, confirmed_contact_role text, confirmed_recipient_email text,
      recipient_confirmed boolean not null, introduction_suitable boolean not null,
      confirmed_by text, confirmed_at timestamptz, updated_at timestamptz not null
    );
    create table lead_import_evidence (
      id uuid primary key default gen_random_uuid(), row_id uuid not null, field text not null,
      candidate_value text not null, source_kind text not null, source_reference text not null,
      selected boolean not null, created_by text not null, created_at timestamptz not null
    );
    insert into organizations(id) values ('10000000-0000-4000-8000-000000000001');
    insert into lead_import_rows(id, review_version, state, recipient_confirmed, introduction_suitable, updated_at)
      values ('30000000-0000-4000-8000-000000000001', 0, 'needs_review', false, false, now());
  `);
  const service = new LeadReviewService(drizzle(client, { schema }) as never);

  await service.confirm({
    rowId: "30000000-0000-4000-8000-000000000001",
    expectedVersion: 0,
    reviewedBy: "Desiree",
    decision: {
      organizationId: "10000000-0000-4000-8000-000000000001",
      contactMode: "organization_inbox",
      contactId: null,
      contactName: "",
      contactRole: "",
      recipientEmail: "societyhall@gmail.com",
      recipientConfirmed: true,
      recipientConflictResolved: false,
      introductionSuitable: true,
      eventName: "Alamosa ARTs Festival (Alamosa) CO",
      startDate: "2026-09-05",
      endDate: "2026-09-05",
      emailEvidence: { sourceKind: "act_description", sourceReference: "act:source-1:version:version-1:path:$.Description" },
      dateEvidence: { sourceKind: "official_website", sourceReference: "https://example.org/2026-event" },
    },
  });

  expect((await client.query(`
    select contact_mode, selected_contact_id, confirmed_contact_name, confirmed_contact_role
    from lead_import_rows
  `)).rows).toEqual([{
    contact_mode: "organization_inbox",
    selected_contact_id: null,
    confirmed_contact_name: null,
    confirmed_contact_role: null,
  }]);
  await client.close();
}, 15_000);
