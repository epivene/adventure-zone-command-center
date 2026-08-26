import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

import { PostgresGmailDraftPersistence } from "./gmail-draft-service";

const clients: PGlite[] = [];
afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

describe("PostgresGmailDraftPersistence CRM history", () => {
  it("atomically links a created draft to profile history and audit with a nullable contact", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      create table activities (
        id uuid primary key default gen_random_uuid(), organization_id uuid, contact_id uuid, booking_id uuid,
        kind text not null, subject text, status text, body text not null, occurred_at timestamptz,
        timeline_sort_at timestamptz not null, date_is_import_fallback boolean not null default false,
        ends_at timestamptz, act_record_id text, source_record_id uuid, source_version_id uuid,
        source_type text, organization_location_id uuid, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), deleted_at timestamptz
      );
      create table audit_entries (
        id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null,
        action text not null, before jsonb, after jsonb, reverses_entry_id uuid, created_at timestamptz not null default now()
      );
      create table lead_gmail_draft_links (
        id uuid primary key, row_id uuid not null, organization_id uuid not null, contact_id uuid,
        google_connection_id uuid not null, communication_template_id uuid not null, template_version text not null,
        recipient_email text not null, subject text not null, body text not null, gmail_draft_id text,
        gmail_message_id text, activity_id uuid, state text not null, last_error_code text,
        idempotency_key text not null, attempt_count integer not null, actor_id text not null,
        created_at timestamptz not null, updated_at timestamptz not null, last_attempt_at timestamptz not null,
        completed_at timestamptz
      );
      insert into lead_gmail_draft_links values (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', null,
        '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
        '2026-prepaid-v1', 'person@example.com', 'Subject', 'Body', null, null, null, 'prepared', null,
        'lead-gmail:11111111-1111-4111-8111-111111111111', 1, 'owner-1',
        '2026-08-26T12:00:00Z', '2026-08-26T12:00:00Z', '2026-08-26T12:00:00Z', null
      );
    `);
    const database = drizzle(client, { schema });
    const preview = {
      withSerializedState: async (_rowId: string, _expectedVersion: number, consume: Function) =>
        database.transaction((tx) => consume({ lead: { organizationId: "22222222-2222-4222-8222-222222222222", contactId: null } }, tx)),
    };
    const persistence = new PostgresGmailDraftPersistence(database as never, preview as never);
    const now = new Date("2026-08-26T12:00:01.000Z");

    const result = await persistence.execute({
      rowId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 7,
      idempotencyKey: "lead-gmail:11111111-1111-4111-8111-111111111111",
      now: () => now,
      attempt: async () => ({ kind: "created", draftId: "gmail-draft-1", messageId: "gmail-message-1" }),
    });

    expect(result).toMatchObject({ state: "created", contactId: null, activityId: expect.any(String) });
    expect((await client.query("select organization_id, contact_id, kind, subject, body from activities")).rows)
      .toEqual([{
        organization_id: "22222222-2222-4222-8222-222222222222",
        contact_id: null,
        kind: "note",
        subject: "Gmail draft created",
        body: "Gmail draft created for person@example.com.\nSubject: Subject\nGmail draft ID: gmail-draft-1",
      }]);
    expect((await client.query("select entity_type, action from audit_entries order by entity_type")).rows)
      .toEqual([
        { entity_type: "activity", action: "create" },
        { entity_type: "lead_gmail_draft_link", action: "create_gmail_draft" },
      ]);
  });
});
