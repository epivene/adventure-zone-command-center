import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import {
  ensureProfileTouchSchema,
  profileTouchReadySql,
} from "../features/organizations/profile-touch-schema";
it("installs activity tracking without changing consolidation decisions and skips repeated writes", async () => {
  const db = new PGlite();
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      const r = await db.exec(sql);
      return { rows: (r.at(-1)?.rows ?? []) as Array<Record<string, unknown>> };
    },
    release: vi.fn(),
  };
  const run = () => ensureProfileTouchSchema({ connect: async () => client });
  try {
    await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now(),name text,place_type text,phone text,address_1 text,address_2 text,city text,region text,postal_code text,website text,last_resort boolean,last_resort_reason text,parent_organization_id uuid,consolidated_into_id uuid);
 CREATE TABLE contacts(id uuid PRIMARY KEY,organization_id uuid,organization_location_id uuid,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE organization_locations(id uuid PRIMARY KEY,organization_id uuid,updated_at timestamptz);
 CREATE TABLE organization_contacts(id uuid PRIMARY KEY,organization_id uuid,contact_id uuid,active boolean);
 CREATE TABLE bookings(id uuid PRIMARY KEY,organization_id uuid,updated_at timestamptz);
 CREATE TABLE activities(id uuid PRIMARY KEY,organization_id uuid,booking_id uuid,contact_id uuid,source_record_id uuid,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE activity_associations(id uuid PRIMARY KEY,activity_id uuid,organization_id uuid,booking_id uuid,contact_id uuid);
 CREATE TABLE follow_ups(id uuid PRIMARY KEY,organization_id uuid,booking_id uuid,contact_id uuid,created_at timestamptz,updated_at timestamptz);
 INSERT INTO organizations(id,name,created_at) VALUES('00000000-0000-0000-0000-000000000001','Original','2020-01-01');`);
    await db.exec(`INSERT INTO contacts(id) VALUES('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
      CREATE TABLE contact_consolidations(source_contact_id uuid PRIMARY KEY REFERENCES contacts(id),canonical_contact_id uuid NOT NULL REFERENCES contacts(id),consolidated_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO contact_consolidations(source_contact_id,canonical_contact_id) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');`);
    const decisions = (await db.query("SELECT * FROM contact_consolidations"))
      .rows;
    await run();
    expect((await db.query(profileTouchReadySql)).rows).toEqual([
      { ready: true },
    ]);
    expect(
      statements.some((s) =>
        /DELETE FROM contact_consolidations|INSERT INTO organization_contacts/.test(
          s,
        ),
      ),
    ).toBe(false);
    await db.exec(
      "UPDATE organizations SET name='Edited' WHERE id='00000000-0000-0000-0000-000000000001'",
    );
    expect(
      (
        await db.query<{ advanced: boolean }>(
          "SELECT last_worked_at > '2020-01-02'::timestamptz AS advanced FROM organizations",
        )
      ).rows[0].advanced,
    ).toBe(true);
    statements.length = 0;
    await run();
    expect(
      statements.some((s) =>
        /CREATE TABLE|ALTER TABLE|DROP TRIGGER|advisory/.test(s),
      ),
    ).toBe(false);
    await db.exec(
      "ALTER TABLE follow_ups DISABLE TRIGGER follow_ups_touch_profile_work",
    );
    expect((await db.query(profileTouchReadySql)).rows).toEqual([
      { ready: false },
    ]);
    await run();
    expect((await db.query(profileTouchReadySql)).rows).toEqual([
      { ready: true },
    ]);
    expect(
      (await db.query("SELECT * FROM contact_consolidations")).rows,
    ).toEqual(decisions);
  } finally {
    await db.close();
  }
});
