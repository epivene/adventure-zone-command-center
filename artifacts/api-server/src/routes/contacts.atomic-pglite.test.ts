import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadActReviewMigrations } from "@workspace/db/migrations";

const databaseContext = vi.hoisted(() => ({ database: undefined as unknown }));

vi.mock("@workspace/db", () => ({
  get db() {
    return databaseContext.database;
  },
}));
vi.mock("@/features/activities/activity-service", () => ({ ActivityService: class {} }));
vi.mock("@/features/activities/activity-repository", () => ({ DrizzleActivityRepository: class {} }));

const contactId = "11111111-1111-4111-8111-111111111111";
const originalNumber = "701-555-0199";
const replacementNumber = "701-555-0100";
const originalAssistedCallingEnabled = process.env.ASSISTED_CALLING_ENABLED;

let app: Express;
let client: PGlite;
let originalPhoneId: string;

const atomicEdit = (firstName = "Ada", legacyPhone = replacementNumber) => ({
  contact: {
    firstName,
    lastName: "Lovelace",
    organizationName: "",
    jobTitle: "",
    email: "",
    phone: legacyPhone,
    address1: "",
    address2: "",
    city: "",
    region: "",
    postalCode: "",
  },
  phones: [{
    id: originalPhoneId,
    number: replacementNumber,
    type: "mobile",
    extension: null,
    label: null,
    primary: true,
  }],
});

beforeAll(async () => {
  process.env.ASSISTED_CALLING_ENABLED = "false";
  client = new PGlite();
  databaseContext.database = drizzle(client);
  await client.exec(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid REFERENCES organizations(id),
      organization_location_id uuid,
      first_name text NOT NULL,
      last_name text NOT NULL,
      email text,
      phone text,
      normalized_phone text,
      quick_add_request_key uuid,
      job_title text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      act_record_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contact_phones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      number text NOT NULL,
      normalized_number text,
      type text NOT NULL DEFAULT 'unknown',
      extension text,
      label text,
      "primary" boolean NOT NULL DEFAULT false,
      source text NOT NULL DEFAULT 'local',
      do_not_call_at timestamptz,
      do_not_call_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX contact_phones_one_primary_per_contact
      ON contact_phones(contact_id) WHERE "primary";
    CREATE TABLE call_sessions (
      id uuid PRIMARY KEY,
      phone_id uuid REFERENCES contact_phones(id) ON DELETE SET NULL
    );
    CREATE TABLE act_contact_sync_states (
      contact_id uuid PRIMARY KEY REFERENCES contacts(id),
      base_snapshot jsonb,
      act_edited_at timestamptz,
      last_synced_at timestamptz,
      local_dirty boolean NOT NULL DEFAULT false,
      state text NOT NULL DEFAULT 'unlinked',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      action text NOT NULL,
      before jsonb,
      after jsonb,
      reverses_entry_id uuid UNIQUE REFERENCES audit_entries(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  const migration = (await loadActReviewMigrations()).find(
    ({ name }) => name === "023_contact_phone_canonical_dnc.sql",
  );
  if (!migration) throw new Error("Migration 023 is missing.");
  await client.exec(migration.sql);

  const { default: contactsRouter } = await import("./contacts");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { log: { error: vi.fn() } });
    next();
  });
  app.use(contactsRouter);
});

beforeEach(async () => {
  await client.exec(`
    DROP TRIGGER IF EXISTS reject_rollback_fixture_contact ON contacts;
    DROP FUNCTION IF EXISTS reject_rollback_fixture_contact();
    TRUNCATE audit_entries, act_contact_sync_states, contact_phones, contacts, organizations CASCADE;
    INSERT INTO contacts (id, first_name, last_name, phone, normalized_phone)
    VALUES ('${contactId}', 'Ada', 'Lovelace', '${originalNumber}', '+17015550199');
  `);
  const [phone] = (await client.query<{ id: string }>(`
    SELECT id FROM contact_phones WHERE contact_id = '${contactId}'
  `)).rows;
  if (!phone) throw new Error("Legacy-phone trigger did not create the fixture phone.");
  originalPhoneId = phone.id;
});

afterAll(async () => {
  if (originalAssistedCallingEnabled === undefined) delete process.env.ASSISTED_CALLING_ENABLED;
  else process.env.ASSISTED_CALLING_ENABLED = originalAssistedCallingEnabled;
  await client.close();
});

describe("atomic contact phone edits with migration 023", () => {
  it("changes a primary destination in place through the real HTTP and repository path", async () => {
    const response = await request(app)
      .put(`/contacts/${contactId}`)
      .send(atomicEdit())
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      phones: [expect.objectContaining({
        id: originalPhoneId,
        number: replacementNumber,
        normalizedNumber: "+17015550100",
        primary: true,
      })],
    });
    expect((await client.query(`
      SELECT id, number, normalized_number, "primary", do_not_call_at
      FROM contact_phones WHERE contact_id = '${contactId}'
    `)).rows).toEqual([{
      id: originalPhoneId,
      number: replacementNumber,
      normalized_number: "+17015550100",
      primary: true,
      do_not_call_at: null,
    }]);
    expect((await client.query(`
      SELECT phone, normalized_phone FROM contacts WHERE id = '${contactId}'
    `)).rows).toEqual([{
      phone: replacementNumber,
      normalized_phone: "+17015550100",
    }]);
  });

  it("treats the saved primary phone as the legacy mirror authority", async () => {
    await request(app)
      .put(`/contacts/${contactId}`)
      .send(atomicEdit("Ada", "701-555-0101"))
      .expect(200);

    expect((await client.query(`
      SELECT number, normalized_number, "primary"
      FROM contact_phones WHERE contact_id = '${contactId}'
    `)).rows).toEqual([{
      number: replacementNumber,
      normalized_number: "+17015550100",
      primary: true,
    }]);
    expect((await client.query(`
      SELECT phone, normalized_phone FROM contacts WHERE id = '${contactId}'
    `)).rows).toEqual([{
      phone: replacementNumber,
      normalized_phone: "+17015550100",
    }]);
  });

  it("keeps a suppressed destination immutable and rolls back contact fields", async () => {
    await client.exec(`
      UPDATE contact_phones
      SET do_not_call_at = '2026-08-01T00:00:00Z', do_not_call_reason = 'Requested'
      WHERE id = '${originalPhoneId}';
    `);

    const response = await request(app)
      .put(`/contacts/${contactId}`)
      .send(atomicEdit("Changed"))
      .expect(400);

    expect(response.body.error).toMatch(/suppressed phone number cannot be changed/i);
    expect((await client.query(`
      SELECT number, normalized_number, "primary", do_not_call_reason
      FROM contact_phones WHERE contact_id = '${contactId}'
    `)).rows).toEqual([{
      number: originalNumber,
      normalized_number: "+17015550199",
      primary: true,
      do_not_call_reason: "Requested",
    }]);
    expect((await client.query(`
      SELECT first_name, phone, normalized_phone FROM contacts WHERE id = '${contactId}'
    `)).rows).toEqual([{
      first_name: "Ada",
      phone: originalNumber,
      normalized_phone: "+17015550199",
    }]);
  });

  it("rolls back the phone replacement when the later contact update fails", async () => {
    await client.exec(`
      CREATE OR REPLACE FUNCTION reject_rollback_fixture_contact()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.first_name = 'Rollback' THEN
          RAISE EXCEPTION 'forced contact update failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      DROP TRIGGER IF EXISTS reject_rollback_fixture_contact ON contacts;
      CREATE TRIGGER reject_rollback_fixture_contact
      BEFORE UPDATE ON contacts
      FOR EACH ROW EXECUTE FUNCTION reject_rollback_fixture_contact();
    `);

    await request(app)
      .put(`/contacts/${contactId}`)
      .send(atomicEdit("Rollback"))
      .expect(500);

    expect((await client.query(`
      SELECT first_name, phone, normalized_phone FROM contacts WHERE id = '${contactId}'
    `)).rows).toEqual([{
      first_name: "Ada",
      phone: originalNumber,
      normalized_phone: "+17015550199",
    }]);
    expect((await client.query(`
      SELECT id, number, normalized_number, "primary"
      FROM contact_phones WHERE contact_id = '${contactId}'
    `)).rows).toEqual([{
      id: originalPhoneId,
      number: originalNumber,
      normalized_number: "+17015550199",
      primary: true,
    }]);
  });
});
