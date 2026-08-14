import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DrizzleActivityRepository } from "./activity-repository";
import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";

const parentOrgId = "00000000-0000-4000-8000-000000000001";
const profileId = "00000000-0000-4000-8000-000000000002";
const contactId = "00000000-0000-4000-8000-000000000003";
const bookingId = "00000000-0000-4000-8000-000000000004";
const orgAssocActivityId = "00000000-0000-4000-8000-000000000011";
const contactAssocActivityId = "00000000-0000-4000-8000-000000000012";
const bookingAssocActivityId = "00000000-0000-4000-8000-000000000013";
const directAndAssocActivityId = "00000000-0000-4000-8000-000000000014";
const unrelatedActivityId = "00000000-0000-4000-8000-000000000015";
const contactDirectAndAssocActivityId = "00000000-0000-4000-8000-000000000016";
const emptyProfileId = "00000000-0000-4000-8000-000000000021";

let client: PGlite;
let database: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client);
  await client.exec(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      place_type text NOT NULL DEFAULT 'company',
      phone text, address_1 text, address_2 text, city text, region text,
      postal_code text, website text,
      last_resort boolean NOT NULL DEFAULT false,
      last_resort_reason text,
      act_record_id text,
      parent_organization_id uuid
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY,
      first_name text NOT NULL DEFAULT '',
      last_name text NOT NULL DEFAULT '',
      phone text, email text, act_record_id text
    );
    CREATE TABLE organization_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      contact_id uuid NOT NULL,
      role text, is_primary boolean NOT NULL DEFAULT false,
      source text NOT NULL DEFAULT 'manual',
      active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY,
      organization_id uuid,
      name text NOT NULL,
      primary_contact_id uuid,
      city text NOT NULL DEFAULT '',
      region text NOT NULL DEFAULT '',
      starts_at timestamptz, ends_at timestamptz,
      status text NOT NULL DEFAULT 'lead',
      probability text NOT NULL DEFAULT '0',
      notes text, act_record_id text
    );
    CREATE TABLE activities (
      id uuid PRIMARY KEY,
      organization_id uuid, contact_id uuid, booking_id uuid,
      kind text NOT NULL,
      subject text, status text,
      body text NOT NULL,
      occurred_at timestamptz,
      timeline_sort_at timestamptz NOT NULL,
      date_is_import_fallback boolean NOT NULL DEFAULT false,
      ends_at timestamptz,
      act_record_id text,
      source_record_id uuid, source_version_id uuid, source_type text,
      organization_location_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE TABLE activity_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_id uuid NOT NULL,
      prior_body text NOT NULL,
      replacement_body text NOT NULL,
      reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE activity_associations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_id uuid NOT NULL,
      organization_id uuid, contact_id uuid, booking_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE follow_ups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid, contact_id uuid, booking_id uuid,
      kind text NOT NULL,
      due_at timestamptz NOT NULL,
      completed_at timestamptz
    );
    CREATE TABLE calling_lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL, kind text NOT NULL, source_status text
    );
    CREATE TABLE calling_list_memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      calling_list_id uuid NOT NULL, contact_id uuid NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL, entity_id uuid NOT NULL,
      source_entity_type text NOT NULL, act_record_id text NOT NULL,
      is_primary boolean NOT NULL DEFAULT false,
      sync_mode text NOT NULL DEFAULT 'imported'
    );
    CREATE TABLE audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL, entity_id uuid NOT NULL,
      action text NOT NULL,
      before jsonb, after jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO organizations (id, name, parent_organization_id)
      VALUES ('${parentOrgId}', 'Parent Co', NULL),
             ('${profileId}', 'Adventure Zone - Austin', '${parentOrgId}'),
             ('${emptyProfileId}', 'Empty Place', '${parentOrgId}');
    INSERT INTO contacts (id, first_name, last_name) VALUES ('${contactId}', 'Ada', 'Lovelace');
    INSERT INTO organization_contacts (organization_id, contact_id, is_primary)
      VALUES ('${profileId}', '${contactId}', true);
    INSERT INTO bookings (id, organization_id, name) VALUES ('${bookingId}', '${profileId}', 'Fall Festival');

    -- Imported Act! history: no direct parent FKs, linked only through activity_associations.
    INSERT INTO activities (id, kind, body, occurred_at, timeline_sort_at) VALUES
      ('${orgAssocActivityId}', 'act_history', 'org-linked import', '2024-03-01T00:00:00Z', '2024-03-01T00:00:00Z'),
      ('${contactAssocActivityId}', 'act_history', 'contact-linked import', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z'),
      ('${bookingAssocActivityId}', 'act_history', 'booking-linked import', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
      ('${unrelatedActivityId}', 'act_history', 'someone else''s import', '2024-01-15T00:00:00Z', '2024-01-15T00:00:00Z');
    -- Manually created activity that also carries an association (dedupe case).
    INSERT INTO activities (id, organization_id, kind, body, occurred_at, timeline_sort_at)
      VALUES ('${directAndAssocActivityId}', '${profileId}', 'note', 'direct + association', '2024-04-01T00:00:00Z', '2024-04-01T00:00:00Z');
    INSERT INTO activities (id, contact_id, kind, body, occurred_at, timeline_sort_at)
      VALUES ('${contactDirectAndAssocActivityId}', '${contactId}', 'note', 'contact direct + association', '2024-05-01T00:00:00Z', '2024-05-01T00:00:00Z');

    INSERT INTO activity_associations (activity_id, organization_id, contact_id, booking_id) VALUES
      ('${orgAssocActivityId}', '${profileId}', NULL, NULL),
      ('${contactAssocActivityId}', NULL, '${contactId}', NULL),
      ('${bookingAssocActivityId}', NULL, NULL, '${bookingId}'),
      ('${directAndAssocActivityId}', '${profileId}', NULL, NULL),
      ('${contactDirectAndAssocActivityId}', NULL, '${contactId}', NULL),
      ('${unrelatedActivityId}', NULL, NULL, '99999999-0000-4000-8000-000000000099');
  `);
});

afterAll(async () => {
  await client.close();
});

describe("association-linked imported history", () => {
  it("shows association-only activities on the contact timeline, deduplicated", async () => {
    const repository = new DrizzleActivityRepository(database as never);
    const page = await repository.listTimeline({ contactId });
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(contactAssocActivityId);
    expect(ids).not.toContain(unrelatedActivityId);
    expect(ids.filter((id) => id === contactDirectAndAssocActivityId)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows association-only activities on the organization timeline, deduplicated", async () => {
    const repository = new DrizzleActivityRepository(database as never);
    const page = await repository.listTimeline({ organizationId: profileId });
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(orgAssocActivityId);
    expect(ids.filter((id) => id === directAndAssocActivityId)).toHaveLength(1);
    expect(ids).not.toContain(unrelatedActivityId);
  });

  it("includes organization-, contact-, and booking-linked imports in event profile notes", async () => {
    const repository = new DrizzleEventProfileRepository(database as never);
    const profile = await repository.getEventProfile(profileId);
    expect(profile).not.toBeNull();
    const noteIds = profile!.notes.map((note) => note.id);
    expect(noteIds).toContain(orgAssocActivityId);
    expect(noteIds).toContain(contactAssocActivityId);
    expect(noteIds).toContain(bookingAssocActivityId);
    expect(noteIds).not.toContain(unrelatedActivityId);
    expect(noteIds.filter((id) => id === directAndAssocActivityId)).toHaveLength(1);
    expect(new Set(noteIds).size).toBe(noteIds.length);
  });

  it("keeps other profiles' association-linked history off an unrelated profile", async () => {
    const repository = new DrizzleEventProfileRepository(database as never);
    const profile = await repository.getEventProfile(emptyProfileId);
    expect(profile).not.toBeNull();
    expect(profile!.notes).toEqual([]);
  });
});
