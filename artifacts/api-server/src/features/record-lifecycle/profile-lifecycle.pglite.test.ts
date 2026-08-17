import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProfileLifecycleService } from "./profile-lifecycle-service";

const profileId = "10000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000001";
const bookingId = "30000000-0000-4000-8000-000000000001";
const activityId = "40000000-0000-4000-8000-000000000001";
const relationshipId = "50000000-0000-4000-8000-000000000001";
const familyMemberId = "60000000-0000-4000-8000-000000000001";

let client: PGlite;
let service: ProfileLifecycleService;

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  service = new ProfileLifecycleService(database as never);

  await client.exec(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      city text,
      region text,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY,
      first_name text NOT NULL,
      last_name text NOT NULL
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      name text NOT NULL
    );
    CREATE TABLE organization_contacts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      contact_id uuid NOT NULL
    );
    CREATE TABLE activities (
      id uuid PRIMARY KEY,
      body text NOT NULL
    );
    CREATE TABLE activity_associations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_id uuid NOT NULL,
      organization_id uuid
    );
    CREATE TABLE event_family_members (
      id uuid PRIMARY KEY,
      family_id uuid NOT NULL,
      organization_id uuid NOT NULL
    );
    CREATE TABLE audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      action text NOT NULL,
      before jsonb,
      after jsonb,
      reverses_entry_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO organizations (id, name, city, region)
      VALUES ('${profileId}', '16th Street Fair', 'Denver', 'CO');
    INSERT INTO contacts (id, first_name, last_name)
      VALUES ('${contactId}', 'Downtown', 'Denver');
    INSERT INTO bookings (id, organization_id, name)
      VALUES ('${bookingId}', '${profileId}', '2027 16th Street Fair');
    INSERT INTO organization_contacts (id, organization_id, contact_id)
      VALUES ('${relationshipId}', '${profileId}', '${contactId}');
    INSERT INTO activities (id, body)
      VALUES ('${activityId}', 'Meaningful imported history');
    INSERT INTO activity_associations (activity_id, organization_id)
      VALUES ('${activityId}', '${profileId}');
    INSERT INTO event_family_members (id, family_id, organization_id)
      VALUES ('${familyMemberId}', gen_random_uuid(), '${profileId}');
  `);
});

afterEach(async () => client.close());

async function rowIds(table: string) {
  const result = await client.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`);
  return result.rows.map((row) => row.id);
}

describe("profile archive lifecycle", () => {
  it("archives and restores only the profile row while preserving linked CRM data", async () => {
    const before = {
      contacts: await rowIds("contacts"),
      bookings: await rowIds("bookings"),
      relationships: await rowIds("organization_contacts"),
      activities: await rowIds("activities"),
      familyMembers: await rowIds("event_family_members"),
    };

    const archived = await service.archive(profileId, "owner");
    expect(archived.id).toBe(profileId);
    expect(archived.archivedAt).toBeInstanceOf(Date);

    const archivedRow = await client.query<{ archived_at: Date | null }>(
      "SELECT archived_at FROM organizations WHERE id = $1",
      [profileId],
    );
    expect(archivedRow.rows[0]?.archived_at).not.toBeNull();
    expect(await rowIds("contacts")).toEqual(before.contacts);
    expect(await rowIds("bookings")).toEqual(before.bookings);
    expect(await rowIds("organization_contacts")).toEqual(before.relationships);
    expect(await rowIds("activities")).toEqual(before.activities);
    expect(await rowIds("event_family_members")).toEqual(before.familyMembers);

    const repeatArchive = await service.archive(profileId, "owner");
    expect(repeatArchive.archivedAt?.toISOString()).toBe(archived.archivedAt?.toISOString());

    const restored = await service.restore(profileId, "owner");
    expect(restored).toEqual({ id: profileId, archivedAt: null });
    expect((await client.query("SELECT archived_at FROM organizations WHERE id = $1", [profileId])).rows)
      .toEqual([{ archived_at: null }]);
    expect(await rowIds("contacts")).toEqual(before.contacts);
    expect(await rowIds("bookings")).toEqual(before.bookings);
    expect(await rowIds("organization_contacts")).toEqual(before.relationships);
    expect(await rowIds("activities")).toEqual(before.activities);
    expect(await rowIds("event_family_members")).toEqual(before.familyMembers);

    const audits = await client.query<{ action: string }>(
      "SELECT action FROM audit_entries WHERE entity_type = 'organization' AND entity_id = $1 ORDER BY created_at",
      [profileId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(["archive_profile", "restore_profile"]);
  });

  it("lists archived profiles newest first", async () => {
    await service.archive(profileId, "owner");
    const profiles = await service.listArchived();

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: profileId,
      name: "16th Street Fair",
      city: "Denver",
      region: "CO",
    });
    expect(profiles[0]?.archivedAt).toBeInstanceOf(Date);
  });
});
