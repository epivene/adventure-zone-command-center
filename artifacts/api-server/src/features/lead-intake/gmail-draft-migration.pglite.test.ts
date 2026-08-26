import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.close())); });

describe("lead Gmail draft link migration", () => {
  it("creates the forward, idempotent internal record with a nullable contact and one row link", async () => {
    const db = new PGlite();
    databases.push(db);
    await db.exec(`
      create extension if not exists pgcrypto;
      create table organizations (id uuid primary key);
      create table contacts (id uuid primary key);
      create table lead_import_rows (id uuid primary key);
      create table google_workspace_connections (id uuid primary key);
      create table communication_templates (id uuid primary key);
      create table activities (id uuid primary key);
    `);
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/20260826_lead_gmail_drafts.sql", import.meta.url)),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);

    await db.exec(`
      insert into organizations values ('22222222-2222-4222-8222-222222222222');
      insert into lead_import_rows values ('11111111-1111-4111-8111-111111111111');
      insert into google_workspace_connections values ('33333333-3333-4333-8333-333333333333');
      insert into communication_templates values ('44444444-4444-4444-8444-444444444444');
      insert into lead_gmail_draft_links (
        row_id, organization_id, contact_id, google_connection_id, communication_template_id,
        template_version, recipient_email, subject, body, state, idempotency_key, attempt_count,
        actor_id, last_attempt_at
      ) values (
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        null,
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        '2026-prepaid-v1', 'person@example.com', 'Subject', E'Hi,\\nBody', 'prepared',
        'lead-gmail:11111111-1111-4111-8111-111111111111', 1, 'owner-1', now()
      );
    `);

    const columns = await db.query<{ column_name: string; is_nullable: string }>(
      "select column_name, is_nullable from information_schema.columns where table_name = 'lead_gmail_draft_links'",
    );
    expect(columns.rows.find((column) => column.column_name === "contact_id")?.is_nullable).toBe("YES");
    expect(columns.rows.find((column) => column.column_name === "activity_id")?.is_nullable).toBe("YES");
    await expect(db.exec(`
      update lead_gmail_draft_links
      set state = 'created', gmail_draft_id = 'draft', gmail_message_id = 'message', completed_at = now()
    `)).rejects.toThrow();

    await expect(db.exec(`
      insert into lead_gmail_draft_links (
        row_id, organization_id, google_connection_id, communication_template_id, template_version,
        recipient_email, subject, body, state, idempotency_key, attempt_count, actor_id, last_attempt_at
      ) values (
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        '2026-prepaid-v1', 'other@example.com', 'Other', 'Other', 'prepared',
        'other-key', 1, 'owner-2', now()
      )
    `)).rejects.toThrow();
  });
});
