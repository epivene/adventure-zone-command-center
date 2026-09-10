import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { ensureGoogleDriveBackupSchemaBeforeListen } from "./google-drive-backup-required-startup";

const migrationSql = readFileSync(
  new URL(
    "../../../../lib/db/migrations/20260909_google_drive_backup_exports.sql",
    import.meta.url,
  ),
  "utf8",
);

const organizationId = "11111111-1111-4111-8111-111111111111";
const contactId = "22222222-2222-4222-8222-222222222222";
const bookingId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";

async function installPrerequisites(db: PGlite) {
  await db.exec(`
    CREATE TABLE google_workspace_connections (id uuid PRIMARY KEY);
    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY,
      organization_id uuid REFERENCES organizations(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY,
      organization_id uuid REFERENCES organizations(id),
      primary_contact_id uuid REFERENCES contacts(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE follow_ups (
      id uuid PRIMARY KEY,
      booking_id uuid REFERENCES bookings(id),
      organization_id uuid REFERENCES organizations(id),
      contact_id uuid REFERENCES contacts(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE activities (
      id uuid PRIMARY KEY,
      organization_id uuid REFERENCES organizations(id),
      contact_id uuid REFERENCES contacts(id),
      booking_id uuid REFERENCES bookings(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE business_documents (
      id uuid PRIMARY KEY,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE business_document_versions (
      id uuid PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES business_documents(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE business_document_links (
      id uuid PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES business_documents(id),
      organization_id uuid REFERENCES organizations(id),
      booking_id uuid REFERENCES bookings(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

describe("Google Drive backup required schema", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await installPrerequisites(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("installs idempotently with a single disabled configuration row", async () => {
    await db.exec(migrationSql);
    await db.exec(migrationSql);

    const result = await db.query<{
      id: string;
      state: string;
      root_folder_id: string | null;
    }>("SELECT id, state, root_folder_id FROM google_drive_backup_config");

    expect(result.rows).toEqual([
      { id: "default", state: "disabled", root_folder_id: null },
    ]);
  });

  it("coalesces organization and contact changes into the owning profile PDFs", async () => {
    await db.exec(migrationSql);
    await db.query("INSERT INTO organizations (id, name) VALUES ($1, 'Fair')", [
      organizationId,
    ]);
    await db.query(
      "INSERT INTO contacts (id, organization_id) VALUES ($1, $2)",
      [contactId, organizationId],
    );
    await db.exec("TRUNCATE google_drive_backup_jobs");

    await db.query(
      "UPDATE contacts SET updated_at = now() + interval '1 second' WHERE id = $1",
      [contactId],
    );
    await db.query(
      "UPDATE contacts SET updated_at = now() + interval '2 seconds' WHERE id = $1",
      [contactId],
    );

    const result = await db.query<{
      entity_kind: string;
      entity_id: string;
      request_generation: number;
      status: string;
    }>(`
      SELECT entity_kind, entity_id, request_generation::int, status
      FROM google_drive_backup_jobs
      ORDER BY entity_kind
    `);

    expect(result.rows).toEqual([
      {
        entity_kind: "follow_up_summary",
        entity_id: organizationId,
        request_generation: 2,
        status: "queued",
      },
      {
        entity_kind: "profile_summary",
        entity_id: organizationId,
        request_generation: 2,
        status: "queued",
      },
    ]);
  });

  it("resolves booking-linked follow-ups to one organization job", async () => {
    await db.exec(migrationSql);
    await db.query("INSERT INTO organizations (id, name) VALUES ($1, 'Fair')", [
      organizationId,
    ]);
    await db.query(
      "INSERT INTO contacts (id, organization_id) VALUES ($1, $2)",
      [contactId, organizationId],
    );
    await db.query(
      "INSERT INTO bookings (id, organization_id, primary_contact_id) VALUES ($1, $2, $3)",
      [bookingId, organizationId, contactId],
    );
    await db.exec("TRUNCATE google_drive_backup_jobs");

    await db.query(
      "INSERT INTO follow_ups (id, booking_id) VALUES (gen_random_uuid(), $1)",
      [bookingId],
    );
    await db.query(
      "UPDATE follow_ups SET updated_at = now() + interval '1 second' WHERE booking_id = $1",
      [bookingId],
    );

    const result = await db.query<{
      entity_kind: string;
      entity_id: string;
      request_generation: number;
    }>(`
      SELECT entity_kind, entity_id, request_generation::int
      FROM google_drive_backup_jobs
    `);

    expect(result.rows).toEqual([
      {
        entity_kind: "follow_up_summary",
        entity_id: organizationId,
        request_generation: 2,
      },
    ]);
  });

  it("coalesces document, version, and link changes into one document job", async () => {
    await db.exec(migrationSql);
    await db.query("INSERT INTO organizations (id, name) VALUES ($1, 'Fair')", [
      organizationId,
    ]);
    await db.exec("TRUNCATE google_drive_backup_jobs");

    await db.query("INSERT INTO business_documents (id) VALUES ($1)", [
      documentId,
    ]);
    await db.query(
      "INSERT INTO business_document_versions (id, document_id) VALUES (gen_random_uuid(), $1)",
      [documentId],
    );
    await db.query(
      "INSERT INTO business_document_links (id, document_id, organization_id) VALUES (gen_random_uuid(), $1, $2)",
      [documentId, organizationId],
    );

    const result = await db.query<{
      entity_kind: string;
      entity_id: string;
      request_generation: number;
    }>(`
      SELECT entity_kind, entity_id, request_generation::int
      FROM google_drive_backup_jobs
      WHERE entity_kind = 'document'
    `);

    expect(result.rows).toEqual([
      {
        entity_kind: "document",
        entity_id: documentId,
        request_generation: 3,
      },
    ]);
  });

  it("applies the canonical schema with a bounded lock timeout", async () => {
    const client = {
      query: vi.fn(async (_sql: string) => ({ rows: [] })),
      release: vi.fn(),
    };

    await expect(
      ensureGoogleDriveBackupSchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
      }),
    ).resolves.toBeUndefined();

    expect(client.query).toHaveBeenNthCalledWith(2, "SET lock_timeout = '5s'");
    expect(String(client.query.mock.calls[2]?.[0])).toContain(
      "CREATE TABLE IF NOT EXISTS google_drive_backup_jobs",
    );
    expect(String(client.query.mock.calls[2]?.[0])).toContain(
      "CREATE TRIGGER google_drive_backup_contacts_enqueue",
    );
    expect(client.query).toHaveBeenLastCalledWith("RESET lock_timeout");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("does not reacquire table locks when the required schema is already ready", async () => {
    await db.exec(migrationSql);
    const queries: string[] = [];
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        queries.push(sql);
        return db.query(sql, values);
      },
      release: vi.fn(),
    };

    await expect(
      ensureGoogleDriveBackupSchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
      }),
    ).resolves.toBeUndefined();

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(
      "google_drive_backup_document_links_enqueue",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("always resets the timeout and releases after a DDL failure", async () => {
    const client = {
      query: vi
        .fn<(sql: string) => Promise<{ rows: never[] }>>()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error("ddl failed"))
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };

    await expect(
      ensureGoogleDriveBackupSchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
      }),
    ).rejects.toThrow("ddl failed");
    expect(client.query).toHaveBeenLastCalledWith("RESET lock_timeout");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
