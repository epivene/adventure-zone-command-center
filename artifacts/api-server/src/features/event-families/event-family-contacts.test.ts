import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, eventFamilies, eventFamilyContacts } from "@workspace/db";
import * as workspaceDb from "@workspace/db";
import { ensureEventFamilySchema, EventFamilyConflictError, EventFamilyNotFoundError, EventFamilyRepository } from "./event-family-repository";

describe("event family website/contact schema", () => {
  it("defines family website, family-contact relationship, migration, and startup registry", () => {
    const familyColumns = getTableColumns(eventFamilies);
    expect(familyColumns).toHaveProperty("website");
    expect(eventFamilyContacts).toBeDefined();

    const migrationPath = resolve(process.cwd(), "../../lib/db/migrations/043_event_family_website_contacts.sql");
    expect(existsSync(migrationPath)).toBe(true);
    if (existsSync(migrationPath)) {
      const sql = readFileSync(migrationPath, "utf8");
      const normalizedSql = sql.replace(/\s+/g, " ");
      expect(normalizedSql).toContain("ALTER TABLE event_families ADD COLUMN IF NOT EXISTS website text");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS event_family_contacts");
      expect(sql).toContain("UNIQUE (family_id, contact_id)");
      expect(sql).toContain("event_family_contacts_one_primary_per_family");
      expect(normalizedSql).toContain("WHERE is_primary = true");
    }

    const registry = readFileSync(resolve(process.cwd(), "../../lib/db/src/migrations.ts"), "utf8");
    expect(registry).toContain('name: "043_event_family_website_contacts.sql"');
  });
});

describe.sequential("event family contact repository", () => {
  const repository = new EventFamilyRepository(pool);
  const familyA = "11111111-1111-4111-8111-111111111111";
  const familyB = "22222222-2222-4222-8222-222222222222";
  const contactA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const contactB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const contactC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  beforeAll(async () => {
    await pool.query(`
      DROP TABLE IF EXISTS scoped_notes CASCADE;
      DROP TABLE IF EXISTS event_family_contacts CASCADE;
      DROP TABLE IF EXISTS event_family_suggestions CASCADE;
      DROP TABLE IF EXISTS event_family_members CASCADE;
      DROP TABLE IF EXISTS event_families CASCADE;
      DROP TABLE IF EXISTS act_contact_sync_states CASCADE;
      DROP TABLE IF EXISTS contacts CASCADE;
      DROP TABLE IF EXISTS organization_locations CASCADE;
      DROP TABLE IF EXISTS organizations CASCADE;
      CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, consolidated_into_id uuid, place_type text DEFAULT 'other', city text, region text);
      CREATE TABLE organization_locations (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id));
      CREATE TABLE contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, first_name text NOT NULL, last_name text NOT NULL,
        email text, phone text, normalized_phone text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE act_contact_sync_states (
        contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
        local_dirty boolean NOT NULL DEFAULT false, state text NOT NULL DEFAULT 'waiting', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await ensureEventFamilySchema(pool);
    await pool.query(`INSERT INTO event_families (id, name, normalized_name) VALUES ($1,'Water Lantern Festival','water lantern festival'), ($2,'Other Family','other family')`, [familyA, familyB]);
    await pool.query(`INSERT INTO contacts (id, first_name, last_name, phone, email) VALUES ($1,'Jane','Smith','701-555-0101','jane@example.com'),($2,'Alex','Lee','701-555-0102','alex@example.com'),($3,'Morgan','Ray','701-555-0103','morgan@example.com')`, [contactA, contactB, contactC]);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS scoped_notes, event_family_contacts, event_family_suggestions, event_family_members, event_families, act_contact_sync_states, contacts, organization_locations, organizations CASCADE`);
  });

  it("saves, returns, and clears the family website", async () => {
    expect(await repository.updateWebsite(familyA, "https://waterlanternfestival.com")).toBe(true);
    expect((await repository.getFamily(familyA))?.website).toBe("https://waterlanternfestival.com");
    expect(await repository.updateWebsite(familyA, null)).toBe(true);
    expect((await repository.getFamily(familyA))?.website).toBeNull();
  });

  it("attaches an existing CRM contact and rejects duplicate links", async () => {
    const linked = await repository.attachContact(familyA, contactA, "Corporate Events", true);
    expect(linked).toMatchObject({ contactId: contactA, name: "Jane Smith", role: "Corporate Events", isPrimary: true });
    await expect(repository.attachContact(familyA, contactA, null, false)).rejects.toBeInstanceOf(EventFamilyConflictError);
  });

  it("switches Primary only within the selected family", async () => {
    await repository.attachContact(familyA, contactB, null, true);
    await repository.attachContact(familyB, contactC, null, true);
    const familyOne = await repository.getFamily(familyA);
    const familyTwo = await repository.getFamily(familyB);
    expect(familyOne?.contacts.find((contact: any) => contact.contactId === contactA)?.isPrimary).toBe(false);
    expect(familyOne?.contacts.find((contact: any) => contact.contactId === contactB)?.isPrimary).toBe(true);
    expect(familyTwo?.contacts.find((contact: any) => contact.contactId === contactC)?.isPrimary).toBe(true);
  });

  it("removes only the family link, leaving the CRM contact intact", async () => {
    expect(await repository.removeFamilyContact(familyA, contactA)).toBe(true);
    const contact = await pool.query(`SELECT id, email FROM contacts WHERE id = $1`, [contactA]);
    expect(contact.rows[0]).toMatchObject({ id: contactA, email: "jane@example.com" });
  });

  it("family deletion cascades family links but never deletes CRM contacts", async () => {
    const disposable = "33333333-3333-4333-8333-333333333333";
    await pool.query(`INSERT INTO event_families (id,name,normalized_name) VALUES ($1,'Disposable','disposable')`, [disposable]);
    await repository.attachContact(disposable, contactA, null, true);
    await pool.query(`DELETE FROM event_families WHERE id = $1`, [disposable]);
    expect((await pool.query(`SELECT count(*)::int AS count FROM event_family_contacts WHERE family_id = $1`, [disposable])).rows[0].count).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS count FROM contacts WHERE id = $1`, [contactA])).rows[0].count).toBe(1);
  });

  it("creates and attaches a normal CRM contact atomically and rolls back for a missing family", async () => {
    const created = await repository.createAndAttachContact(familyA, { firstName: "Taylor", lastName: "Jones", phone: null, email: "taylor@example.com", role: "Director", makePrimary: false });
    expect(created).toMatchObject({ name: "Taylor Jones", role: "Director" });
    expect((await pool.query(`SELECT local_dirty, state FROM act_contact_sync_states WHERE contact_id = $1`, [created.contactId])).rows[0]).toMatchObject({ local_dirty: true, state: "waiting" });

    const before = Number((await pool.query(`SELECT count(*) FROM contacts`)).rows[0].count);
    await expect(repository.createAndAttachContact("99999999-9999-4999-8999-999999999999", { firstName: "Orphan", lastName: "Contact", phone: null, email: null, role: null, makePrimary: false })).rejects.toBeInstanceOf(EventFamilyNotFoundError);
    const after = Number((await pool.query(`SELECT count(*) FROM contacts`)).rows[0].count);
    expect(after).toBe(before);
  });
});
