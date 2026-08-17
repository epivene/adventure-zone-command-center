import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import { ActTimelineRecovery } from "./timeline-recovery";
import type { RecoveryCandidate } from "./recovery-types";

const databaseKey = "html-history-repair";
const organizationId = "20000000-0000-4000-8000-000000000001";
const companySourceId = "10000000-0000-4000-8000-000000000001";
const historySourceId = "10000000-0000-4000-8000-000000000010";
const historyVersionId = "10000000-0000-4000-8000-000000000020";
const rawHtml = `<div dir="ltr"><p><span style="font-family:Arial">Hi,</span></p><p>My name is Amy &amp; I work with Dave.</p></div>`;

let client: PGlite;
let recovery: ActTimelineRecovery;

function candidate(): RecoveryCandidate {
  return {
    itemId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    sourceRecordId: historySourceId,
    sourceVersionId: historyVersionId,
    streamType: "history",
    actRecordId: "act-history-html-1",
    rawSnapshot: {
      id: "act-history-html-1",
      regarding: "E-mail sent",
      details: rawHtml,
      startTime: "2025-07-14T15:58:00Z",
      company: { id: "act-company-1", name: "16th Street Fair (Denver) CO" },
    },
    relationshipEvidence: {},
    leaseToken: crypto.randomUUID(),
    capturedAt: "2026-08-16T18:00:00Z",
  };
}

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  recovery = new ActTimelineRecovery(database as never, new ActRecoverySourceLinkResolver(database as never));
  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY, source_database_key text NOT NULL, stream_type text NOT NULL,
      act_record_id text, relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL,
      source_entity_type text NOT NULL, act_record_id text NOT NULL, source_database_key text,
      source_record_id uuid
    );
    CREATE TABLE act_archive_recovery_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL, source_record_id uuid NOT NULL,
      source_version_id uuid NOT NULL, decision text NOT NULL, target_entity_type text,
      target_entity_id uuid, decided_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE contacts (id uuid PRIMARY KEY);
    CREATE TABLE bookings (id uuid PRIMARY KEY);
    CREATE TABLE activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, contact_id uuid, booking_id uuid,
      kind text NOT NULL, subject text, status text, body text NOT NULL, occurred_at timestamptz,
      timeline_sort_at timestamptz NOT NULL, date_is_import_fallback boolean NOT NULL DEFAULT false,
      ends_at timestamptz, act_record_id text UNIQUE, source_record_id uuid, source_version_id uuid,
      source_type text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE activity_associations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL,
      organization_id uuid, contact_id uuid, booking_id uuid, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX activity_assoc_org_unique ON activity_associations(activity_id, organization_id) WHERE organization_id IS NOT NULL;

    INSERT INTO organizations (id) VALUES ('${organizationId}');
    INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES
      ('${companySourceId}', '${databaseKey}', 'company', 'act-company-1'),
      ('${historySourceId}', '${databaseKey}', 'history', 'act-history-html-1');
    INSERT INTO act_external_links
      (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
    VALUES ('organization', '${organizationId}', 'company', 'act-company-1', '${databaseKey}', '${companySourceId}');
  `);

  const [activity] = (await client.query<{ id: string }>(
    `INSERT INTO activities
      (kind, subject, body, occurred_at, timeline_sort_at, act_record_id, source_record_id, source_version_id, source_type)
     VALUES ('act_history', 'E-mail sent', $1, '2025-07-14T15:58:00Z', '2025-07-14T15:58:00Z',
       'act_history:act-history-html-1', $2, $3, 'history') RETURNING id`,
    [rawHtml, historySourceId, historyVersionId],
  )).rows;
  await client.query(
    `INSERT INTO activity_associations (activity_id, organization_id) VALUES ($1, $2)`,
    [activity!.id, organizationId],
  );
});

afterEach(async () => client.close());

describe("ACT timeline stored HTML repair", () => {
  it("replaces previously imported raw HTML with normalized readable text without duplicating the activity", async () => {
    const result = await recovery.recoverTimeline(candidate());

    expect(result.state).toBe("recovered");
    expect(result.targetSummary).toEqual(expect.objectContaining({ contentRepaired: true }));
    expect((await client.query(
      `SELECT body FROM activities WHERE source_record_id = $1`,
      [historySourceId],
    )).rows).toEqual([{ body: "Hi,\nMy name is Amy & I work with Dave." }]);
    expect((await client.query(
      `SELECT count(*)::int AS count FROM activities WHERE source_record_id = $1`,
      [historySourceId],
    )).rows).toEqual([{ count: 1 }]);
  });
});
