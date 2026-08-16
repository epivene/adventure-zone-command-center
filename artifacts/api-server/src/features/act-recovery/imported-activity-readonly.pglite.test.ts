import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DrizzleActivityRepository } from "@/features/activities/activity-repository";

let client: PGlite;
let database: ReturnType<typeof drizzle>;

beforeEach(async () => {
  client = new PGlite();
  database = drizzle(client);
  await client.exec(`
    CREATE TABLE activities (
      id uuid PRIMARY KEY,
      organization_id uuid,
      contact_id uuid,
      booking_id uuid,
      kind text NOT NULL,
      subject text,
      status text,
      body text NOT NULL,
      occurred_at timestamptz,
      timeline_sort_at timestamptz NOT NULL,
      date_is_import_fallback boolean NOT NULL DEFAULT false,
      ends_at timestamptz,
      act_record_id text,
      source_record_id uuid,
      source_version_id uuid,
      source_type text,
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
    CREATE TABLE call_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      note_activity_id uuid,
      disposition text
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
    INSERT INTO activities (
      id, organization_id, kind, body, occurred_at, timeline_sort_at,
      source_record_id, source_version_id, source_type
    ) VALUES (
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'act_history',
      'Original ACT history',
      '2025-04-16T14:30:00Z',
      '2025-04-16T14:30:00Z',
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002',
      'history'
    );
  `);
});

afterEach(async () => {
  await client.close();
});

describe("imported ACT activity immutability", () => {
  it("rejects edits to source-backed ACT history and leaves the original untouched", async () => {
    const repository = new DrizzleActivityRepository(database as never);

    const result = await repository.edit({
      activityId: "40000000-0000-4000-8000-000000000001",
      body: "Changed history",
      reason: "Should not rewrite ACT",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_ACTIVITY_INPUT",
        message: "Imported ACT history is read-only. Add a new note to record a correction.",
      },
    });
    const rows = await client.query<{ body: string }>(
      "SELECT body FROM activities WHERE id = '40000000-0000-4000-8000-000000000001'",
    );
    expect(rows.rows).toEqual([{ body: "Original ACT history" }]);
  });
});
