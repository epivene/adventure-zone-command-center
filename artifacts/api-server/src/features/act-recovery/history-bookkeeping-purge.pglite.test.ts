import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActHistoryBookkeepingPurgeRepository } from "./history-bookkeeping-purge-repository";
import { ActHistoryBookkeepingPurgeService } from "./history-bookkeeping-purge-service";

const junkSourceId = "10000000-0000-4000-8000-000000000010";
const junkVersionId = "10000000-0000-4000-8000-000000000011";
const relationshipSourceId = "10000000-0000-4000-8000-000000000012";
const relationshipVersionId = "10000000-0000-4000-8000-000000000013";
const meaningfulSourceId = "10000000-0000-4000-8000-000000000020";
const meaningfulVersionId = "10000000-0000-4000-8000-000000000021";
const organizationId = "20000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000002";

let client: PGlite;
let service: ActHistoryBookkeepingPurgeService;

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  service = new ActHistoryBookkeepingPurgeService(
    new ActHistoryBookkeepingPurgeRepository(database as never),
  );

  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY,
      source_database_key text NOT NULL,
      stream_type text NOT NULL,
      source_key text NOT NULL,
      act_record_id text,
      latest_version_id uuid,
      latest_fingerprint text,
      relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE act_source_record_versions (
      id uuid PRIMARY KEY,
      source_record_id uuid NOT NULL,
      source_database_key text NOT NULL,
      fingerprint text NOT NULL,
      raw_snapshot jsonb NOT NULL,
      source_created_at timestamptz,
      source_edited_at timestamptz,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE act_archive_recovery_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      source_record_id uuid NOT NULL,
      source_version_id uuid NOT NULL,
      stream_type text NOT NULL,
      state text NOT NULL DEFAULT 'needs_review'
    );
    CREATE TABLE act_archive_recovery_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      source_record_id uuid NOT NULL,
      source_version_id uuid NOT NULL,
      decision text NOT NULL
    );
    CREATE TABLE act_replacement_observations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_record_id uuid NOT NULL,
      version_id uuid NOT NULL
    );
    CREATE TABLE act_replacement_checkpoints (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_source_record_id uuid,
      source_record_id uuid
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_record_id uuid
    );
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE contacts (id uuid PRIMARY KEY);
    CREATE TABLE activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      body text NOT NULL,
      source_record_id uuid,
      source_version_id uuid
    );
    CREATE TABLE activity_associations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_id uuid NOT NULL,
      organization_id uuid,
      contact_id uuid
    );
    CREATE TABLE activity_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      activity_id uuid NOT NULL
    );
    CREATE TABLE call_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      note_activity_id uuid
    );

    INSERT INTO organizations (id) VALUES ('${organizationId}');
    INSERT INTO contacts (id) VALUES ('${contactId}');

    INSERT INTO act_source_records
      (id, source_database_key, stream_type, source_key, act_record_id, latest_version_id, latest_fingerprint, relationship_evidence)
    VALUES
      ('${junkSourceId}', 'db-1', 'history', 'history:junk', 'history-junk-1', '${junkVersionId}', 'fp-junk', '{}'),
      ('${relationshipSourceId}', 'db-1', 'history_company', 'history_company:junk', NULL, '${relationshipVersionId}', 'fp-rel', '{"parentActRecordId":"history-junk-1"}'),
      ('${meaningfulSourceId}', 'db-1', 'history', 'history:meaningful', 'history-meaningful-1', '${meaningfulVersionId}', 'fp-good', '{}');

    INSERT INTO act_source_record_versions
      (id, source_record_id, source_database_key, fingerprint, raw_snapshot, fetched_at)
    VALUES
      ('${junkVersionId}', '${junkSourceId}', 'db-1', 'fp-junk', '{"details":"Contact Downtown Denver linked","startTime":"2023-01-11T12:00:00Z"}', now()),
      ('${relationshipVersionId}', '${relationshipSourceId}', 'db-1', 'fp-rel', '{"company":{"id":"company-1"}}', now()),
      ('${meaningfulVersionId}', '${meaningfulSourceId}', 'db-1', 'fp-good', '{"details":"Amy called and asked us to follow up next Tuesday.","startTime":"2025-04-16T12:00:00Z"}', now());

    INSERT INTO act_archive_recovery_items (run_id, source_record_id, source_version_id, stream_type)
      VALUES (gen_random_uuid(), '${junkSourceId}', '${junkVersionId}', 'history');
    INSERT INTO act_archive_recovery_decisions (run_id, source_record_id, source_version_id, decision)
      VALUES (gen_random_uuid(), '${junkSourceId}', '${junkVersionId}', 'drop_unusable');
    INSERT INTO act_replacement_observations (source_record_id, version_id)
      VALUES ('${junkSourceId}', '${junkVersionId}'), ('${relationshipSourceId}', '${relationshipVersionId}');
    INSERT INTO act_replacement_checkpoints (parent_source_record_id, source_record_id)
      VALUES ('${junkSourceId}', '${relationshipSourceId}');
    INSERT INTO act_external_links (source_record_id) VALUES ('${junkSourceId}');

    WITH created AS (
      INSERT INTO activities (body, source_record_id, source_version_id)
      VALUES ('Contact Downtown Denver linked', '${junkSourceId}', '${junkVersionId}')
      RETURNING id
    )
    INSERT INTO activity_associations (activity_id, organization_id, contact_id)
      SELECT id, '${organizationId}', '${contactId}' FROM created;

    INSERT INTO activity_revisions (activity_id)
      SELECT id FROM activities WHERE source_record_id = '${junkSourceId}';
    INSERT INTO call_sessions (note_activity_id)
      SELECT id FROM activities WHERE source_record_id = '${junkSourceId}';
  `);
});

afterEach(async () => client.close());

async function count(table: string, where = "") {
  const result = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} ${where}`);
  return result.rows[0]?.count ?? -1;
}

describe("permanent ACT bookkeeping purge", () => {
  it("removes every local representation of junk history and keeps meaningful CRM data", async () => {
    const summary = await service.purgeNextBatch({ batchSize: 10 });

    expect(summary.purged).toBe(1);
    expect(summary.retained).toBe(1);
    expect(summary.byReason.relationship_bookkeeping).toBe(1);

    expect(await count("activities", `WHERE source_record_id = '${junkSourceId}'`)).toBe(0);
    expect(await count("activity_associations")).toBe(0);
    expect(await count("activity_revisions")).toBe(0);
    expect(await count("act_archive_recovery_items", `WHERE source_record_id = '${junkSourceId}'`)).toBe(0);
    expect(await count("act_archive_recovery_decisions", `WHERE source_record_id = '${junkSourceId}'`)).toBe(0);
    expect(await count("act_source_record_versions", `WHERE source_record_id IN ('${junkSourceId}','${relationshipSourceId}')`)).toBe(0);
    expect(await count("act_source_records", `WHERE id IN ('${junkSourceId}','${relationshipSourceId}')`)).toBe(0);
    expect(await count("act_replacement_observations")).toBe(0);
    expect(await count("act_external_links", `WHERE source_record_id = '${junkSourceId}'`)).toBe(0);

    const checkpoint = await client.query("SELECT parent_source_record_id, source_record_id FROM act_replacement_checkpoints");
    expect(checkpoint.rows).toEqual([{ parent_source_record_id: null, source_record_id: null }]);
    expect((await client.query("SELECT note_activity_id FROM call_sessions")).rows)
      .toEqual([{ note_activity_id: null }]);

    expect(await count("organizations", `WHERE id = '${organizationId}'`)).toBe(1);
    expect(await count("contacts", `WHERE id = '${contactId}'`)).toBe(1);
    expect(await count("act_source_records", `WHERE id = '${meaningfulSourceId}'`)).toBe(1);
    expect(await count("act_source_record_versions", `WHERE id = '${meaningfulVersionId}'`)).toBe(1);

    const second = await service.purgeNextBatch({ batchSize: 10 });
    expect(second.purged).toBe(0);
    expect(await count("act_source_records", `WHERE id = '${meaningfulSourceId}'`)).toBe(1);
  });
});
