import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { DrizzleActArchiveRecoveryRepository } from "./recovery-repository";
import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import { ActTimelineRecovery } from "./timeline-recovery";
import type { RecoveryCandidate } from "./recovery-types";

const wrongOrganizationId = "20000000-0000-4000-8000-000000000001";
const correctOrganizationId = "20000000-0000-4000-8000-000000000002";
const companySource = "10000000-0000-4000-8000-000000000001";
const historySource = "10000000-0000-4000-8000-000000000002";
const historyCompanyRelationship = "10000000-0000-4000-8000-000000000003";
const databaseKey = "act-note-profile-repair";

const clients: PGlite[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function candidate(): RecoveryCandidate {
  return {
    itemId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    sourceVersionId: crypto.randomUUID(),
    leaseToken: crypto.randomUUID(),
    sourceRecordId: historySource,
    streamType: "history",
    actRecordId: "act-history-1",
    rawSnapshot: {
      id: "act-history-1",
      regarding: "Called fair office",
      details: "Asked about next year's dates",
      startTime: "2025-06-01T12:00:00Z",
    },
    relationshipEvidence: {},
    capturedAt: "2026-08-08T12:00:00Z",
  };
}

describe("legacy ACT note profile repair", () => {
  it("moves a legacy imported note off the wrong direct profile once exact ACT ownership is known", async () => {
    const client = new PGlite();
    clients.push(client);
    const database = drizzle(client);
    const recovery = new ActTimelineRecovery(
      database as never,
      new ActRecoverySourceLinkResolver(database as never),
    );

    await client.exec(`
      CREATE TABLE act_source_records (
        id uuid PRIMARY KEY,
        source_database_key text NOT NULL,
        stream_type text NOT NULL,
        act_record_id text,
        relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE act_external_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type text NOT NULL,
        entity_id uuid NOT NULL,
        source_entity_type text NOT NULL,
        act_record_id text NOT NULL,
        source_database_key text,
        source_record_id uuid
      );
      CREATE TABLE act_archive_recovery_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id uuid NOT NULL,
        source_record_id uuid NOT NULL,
        source_version_id uuid NOT NULL,
        decision text NOT NULL,
        target_entity_type text,
        target_entity_id uuid,
        decided_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE organizations (id uuid PRIMARY KEY);
      CREATE TABLE contacts (id uuid PRIMARY KEY);
      CREATE TABLE bookings (id uuid PRIMARY KEY);
      CREATE TABLE calling_lists (id uuid PRIMARY KEY);
      CREATE TABLE activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
        act_record_id text UNIQUE,
        source_record_id uuid,
        source_version_id uuid,
        source_type text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE TABLE activity_associations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        activity_id uuid NOT NULL,
        organization_id uuid,
        contact_id uuid,
        booking_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX activity_assoc_org_unique
        ON activity_associations(activity_id, organization_id)
        WHERE organization_id IS NOT NULL;
      CREATE UNIQUE INDEX activity_assoc_contact_unique
        ON activity_associations(activity_id, contact_id)
        WHERE contact_id IS NOT NULL;
      CREATE UNIQUE INDEX activity_assoc_booking_unique
        ON activity_associations(activity_id, booking_id)
        WHERE booking_id IS NOT NULL;

      INSERT INTO organizations (id) VALUES
        ('${wrongOrganizationId}'),
        ('${correctOrganizationId}');
      INSERT INTO act_source_records
        (id, source_database_key, stream_type, act_record_id)
      VALUES
        ('${companySource}', '${databaseKey}', 'company', 'act-company-correct'),
        ('${historySource}', '${databaseKey}', 'history', 'act-history-1');
      INSERT INTO act_source_records
        (id, source_database_key, stream_type, relationship_evidence)
      VALUES
        ('${historyCompanyRelationship}', '${databaseKey}', 'history_company',
         '{"parentKind":"history","parentActRecordId":"act-history-1","targetKind":"company","targetActRecordId":"act-company-correct"}');
      INSERT INTO act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
      VALUES
        ('organization', '${correctOrganizationId}', 'company', 'act-company-correct', '${databaseKey}', '${companySource}');
    `);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO activities
        (organization_id, kind, subject, body, occurred_at, timeline_sort_at, act_record_id,
         source_record_id, source_version_id, source_type)
       VALUES ($1, 'act_history', 'Called fair office', 'Asked about next year''s dates',
         '2025-06-01T12:00:00Z', '2025-06-01T12:00:00Z', 'act_history:act-history-1',
         $2, $3, 'history')
       RETURNING id`,
      [wrongOrganizationId, historySource, crypto.randomUUID()],
    );
    const activityId = inserted.rows[0]!.id;
    await client.query(
      `INSERT INTO activity_associations (activity_id, organization_id) VALUES ($1, $2)`,
      [activityId, wrongOrganizationId],
    );

    const result = await recovery.recoverTimeline(candidate());

    expect(result.state).toBe("recovered");
    expect((await client.query(
      `SELECT organization_id, contact_id, booking_id FROM activities WHERE id = $1`,
      [activityId],
    )).rows).toEqual([{ organization_id: null, contact_id: null, booking_id: null }]);
    expect((await client.query(
      `SELECT organization_id FROM activity_associations WHERE activity_id = $1 ORDER BY organization_id`,
      [activityId],
    )).rows).toEqual([{ organization_id: correctOrganizationId }]);
  });

  it("can create a repair recovery run containing only ACT timeline streams", async () => {
    const client = new PGlite();
    clients.push(client);
    const database = drizzle(client);
    const repository = new DrizzleActArchiveRecoveryRepository(database as never);

    await client.exec(`
      CREATE TABLE act_source_records (
        id uuid PRIMARY KEY,
        source_database_key text NOT NULL,
        stream_type text NOT NULL,
        source_key text NOT NULL,
        act_record_id text,
        latest_version_id uuid,
        relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE act_source_record_versions (
        id uuid PRIMARY KEY,
        source_record_id uuid NOT NULL REFERENCES act_source_records(id),
        raw_snapshot jsonb NOT NULL,
        UNIQUE (id, source_record_id)
      );
    `);
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/043_act_archive_full_recovery.sql", import.meta.url)),
      "utf8",
    );
    await client.exec(migration);

    for (const [index, streamType] of ["company", "note", "history"].entries()) {
      const sourceId = `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
      const versionId = `20000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
      await client.query(
        `INSERT INTO act_source_records
          (id, source_database_key, stream_type, source_key, act_record_id)
         VALUES ($1, $2, $3, $4, $4)`,
        [sourceId, databaseKey, streamType, `${streamType}-${index}`],
      );
      await client.query(
        `INSERT INTO act_source_record_versions (id, source_record_id, raw_snapshot)
         VALUES ($1, $2, $3::jsonb)`,
        [versionId, sourceId, JSON.stringify({ id: `${streamType}-${index}` })],
      );
      await client.query(
        `UPDATE act_source_records SET latest_version_id = $1 WHERE id = $2`,
        [versionId, sourceId],
      );
    }

    const run = await repository.createOrGetRun({
      sourceDatabaseKey: databaseKey,
      requestKey: "act-note-profile-repair-v2",
      requestedBy: "system",
      now: new Date("2026-08-21T16:00:00Z"),
      streamTypes: ["note", "history", "activity"],
    } as Parameters<typeof repository.createOrGetRun>[0]);

    expect(run.candidateCount).toBe(2);
    expect((await client.query(
      `SELECT stream_type FROM act_archive_recovery_items ORDER BY stream_type`,
    )).rows).toEqual([{ stream_type: "history" }, { stream_type: "note" }]);
  });

  it("schedules the timeline-only repair run when the archive runtime starts", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../act-replacement/runtime.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("act-note-profile-repair-v2");
    expect(source).toContain('streamTypes: ["note", "history", "activity"]');
  });
});
