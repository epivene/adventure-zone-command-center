import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { ensureGoogleWorkspaceSchema } from "./google-workspace-startup-migration";

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE contacts (id uuid PRIMARY KEY);
  `);
  await ensureGoogleWorkspaceSchema(db as never);
  await db.exec(`
    INSERT INTO organizations(id) VALUES
      ('10000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000002');
    INSERT INTO google_workspace_connections(
      id, account_email, encrypted_refresh_token, granted_scopes
    ) VALUES (
      '20000000-0000-4000-8000-000000000001',
      'theadventurezone12@gmail.com',
      '{}'::jsonb,
      '[]'::jsonb
    );
  `);
  return db;
}

describe("Gmail profile label startup migration", () => {
  it("allows only one label mapping per profile", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO google_workspace_profile_labels(
          connection_id, organization_id, gmail_label_id, gmail_label_name
        ) VALUES (
          '20000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          'Label_1',
          'Z - AdventureZone/Profiles/First'
        );
      `);
      await expect(db.exec(`
        INSERT INTO google_workspace_profile_labels(
          connection_id, organization_id, gmail_label_id, gmail_label_name
        ) VALUES (
          '20000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          'Label_2',
          'Z - AdventureZone/Profiles/First duplicate'
        );
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("allows one profile owner per Gmail label id", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO google_workspace_profile_labels(
          connection_id, organization_id, gmail_label_id, gmail_label_name
        ) VALUES (
          '20000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001',
          'Label_1',
          'Z - AdventureZone/Profiles/First'
        );
      `);
      await expect(db.exec(`
        INSERT INTO google_workspace_profile_labels(
          connection_id, organization_id, gmail_label_id, gmail_label_name
        ) VALUES (
          '20000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000002',
          'Label_1',
          'Z - AdventureZone/Profiles/Second'
        );
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("deduplicates Gmail mutation intents", async () => {
    const db = await database();
    try {
      await db.exec(`
        INSERT INTO google_workspace_gmail_mutations(
          connection_id, message_id, thread_id, organization_id,
          operation, idempotency_key
        ) VALUES (
          '20000000-0000-4000-8000-000000000001',
          'message-1',
          'thread-1',
          '10000000-0000-4000-8000-000000000001',
          'assign_thread',
          'assign-thread:one'
        );
      `);
      await expect(db.exec(`
        INSERT INTO google_workspace_gmail_mutations(
          connection_id, message_id, thread_id, organization_id,
          operation, idempotency_key
        ) VALUES (
          '20000000-0000-4000-8000-000000000001',
          'message-2',
          'thread-2',
          '10000000-0000-4000-8000-000000000002',
          'assign_thread',
          'assign-thread:one'
        );
      `)).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
