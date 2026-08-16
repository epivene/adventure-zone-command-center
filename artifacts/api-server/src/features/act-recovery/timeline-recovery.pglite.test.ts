import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import { ActTimelineRecovery } from "./timeline-recovery";
import type { RecoveryCandidate } from "./recovery-types";

const databaseKey = "timeline-recovery";
const organizationId = "20000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000002";
const companySource = "10000000-0000-4000-8000-000000000001";
const contactSource = "10000000-0000-4000-8000-000000000002";
const historySource = "10000000-0000-4000-8000-000000000010";
const historyCompanyRel = "10000000-0000-4000-8000-000000000011";
const historyContactRel = "10000000-0000-4000-8000-000000000012";

let client: PGlite;
let recovery: ActTimelineRecovery;

function candidate(
  sourceRecordId: string,
  streamType: "note" | "history" | "activity",
  actRecordId: string,
  rawSnapshot: Record<string, unknown>,
): RecoveryCandidate {
  return {
    itemId: crypto.randomUUID(), runId: crypto.randomUUID(), sourceVersionId: crypto.randomUUID(), leaseToken: crypto.randomUUID(),
    sourceRecordId, streamType, actRecordId, rawSnapshot, relationshipEvidence: {},
    capturedAt: "2026-08-08T12:00:00Z",
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
    CREATE TABLE calling_lists (id uuid PRIMARY KEY);
    CREATE TABLE activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, contact_id uuid, booking_id uuid,
      kind text NOT NULL, subject text, status text, body text NOT NULL, occurred_at timestamptz,
      timeline_sort_at timestamptz NOT NULL, date_is_import_fallback boolean NOT NULL DEFAULT false,
      ends_at timestamptz, act_record_id text UNIQUE, source_record_id uuid, source_version_id uuid,
      source_type text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    );
    CREATE TABLE activity_associations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL,
      organization_id uuid, contact_id uuid, booking_id uuid, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX activity_assoc_org_unique ON activity_associations(activity_id, organization_id) WHERE organization_id IS NOT NULL;
    CREATE UNIQUE INDEX activity_assoc_contact_unique ON activity_associations(activity_id, contact_id) WHERE contact_id IS NOT NULL;
    CREATE UNIQUE INDEX activity_assoc_booking_unique ON activity_associations(activity_id, booking_id) WHERE booking_id IS NOT NULL;

    INSERT INTO organizations (id) VALUES ('${organizationId}');
    INSERT INTO contacts (id) VALUES ('${contactId}');
    INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES
      ('${companySource}', '${databaseKey}', 'company', 'act-company-1'),
      ('${contactSource}', '${databaseKey}', 'contact', 'act-contact-1'),
      ('${historySource}', '${databaseKey}', 'history', 'act-history-1');
    INSERT INTO act_external_links
      (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
    VALUES
      ('organization', '${organizationId}', 'company', 'act-company-1', '${databaseKey}', '${companySource}'),
      ('contact', '${contactId}', 'contact', 'act-contact-1', '${databaseKey}', '${contactSource}');
    INSERT INTO act_source_records (id, source_database_key, stream_type, relationship_evidence) VALUES
      ('${historyCompanyRel}', '${databaseKey}', 'history_company',
       '{"parentKind":"history","parentActRecordId":"act-history-1","targetKind":"company","targetActRecordId":"act-company-1"}'),
      ('${historyContactRel}', '${databaseKey}', 'history_contact',
       '{"parentKind":"history","parentActRecordId":"act-history-1","targetKind":"contact","targetActRecordId":"act-contact-1"}');
  `);
});

afterEach(async () => client.close());

describe("ActTimelineRecovery", () => {
  it("preserves real ACT history/email content and exact ACT date", async () => {
    const result = await recovery.recoverTimeline(candidate(historySource, "history", "act-history-1", {
      id: "act-history-1",
      regarding: "E-mail sent",
      details: "Proposal package sent",
      startTime: "2025-04-16T14:30:00Z",
    }));
    expect(result.state).toBe("recovered");
    expect((await client.query(`SELECT kind, subject, body, occurred_at, source_type FROM activities WHERE source_record_id = $1`, [historySource])).rows).toEqual([
      {
        kind: "act_history",
        subject: "E-mail sent",
        body: "Proposal package sent",
        occurred_at: new Date("2025-04-16T14:30:00Z"),
        source_type: "history",
      },
    ]);
  });

  it("uses meaningful ACT regarding text when history details are empty", async () => {
    const sourceId = "10000000-0000-4000-8000-000000000020";
    await client.query(`INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES ($1, $2, 'history', 'act-history-2')`, [sourceId, databaseKey]);
    await client.query(`INSERT INTO act_source_records (id, source_database_key, stream_type, relationship_evidence) VALUES ($1, $2, 'history_company', $3::jsonb)`, [
      "10000000-0000-4000-8000-000000000021", databaseKey,
      JSON.stringify({ parentKind: "history", parentActRecordId: "act-history-2", targetKind: "company", targetActRecordId: "act-company-1" }),
    ]);
    const result = await recovery.recoverTimeline(candidate(sourceId, "history", "act-history-2", {
      id: "act-history-2", regarding: "Added contact", details: "", startTime: "2024-01-01T10:00:00Z",
    }));
    expect(result.state).toBe("recovered");
    expect((await client.query(`SELECT body FROM activities WHERE source_record_id = $1`, [sourceId])).rows).toEqual([{ body: "Added contact" }]);
  });

  it("creates one activity with every exact parent association and stays idempotent", async () => {
    const source = candidate(historySource, "history", "act-history-1", {
      id: "act-history-1", regarding: "E-mail sent", details: "Proposal package sent", startTime: "2025-04-16T14:30:00Z",
    });
    const first = await recovery.recoverTimeline(source);
    const second = await recovery.recoverTimeline(source);
    expect(first.state).toBe("recovered");
    expect(second.state).toBe("already_present");
    expect((await client.query(`SELECT count(*)::int AS count FROM activities WHERE source_record_id = $1`, [historySource])).rows).toEqual([{ count: 1 }]);
    expect((await client.query(`SELECT organization_id, contact_id FROM activity_associations ORDER BY organization_id NULLS LAST, contact_id NULLS LAST`)).rows).toEqual([
      { organization_id: organizationId, contact_id: null },
      { organization_id: null, contact_id: contactId },
    ]);
  });

  it("repairs a missing association on an already imported ACT activity", async () => {
    const [activity] = (await client.query<{ id: string }>(
      `INSERT INTO activities (kind, subject, body, occurred_at, timeline_sort_at, act_record_id, source_record_id, source_version_id, source_type)
       VALUES ('act_history', 'E-mail sent', 'Proposal package sent', now(), now(), 'act_history:act-history-1', $1, $2, 'history') RETURNING id`,
      [historySource, crypto.randomUUID()],
    )).rows;
    await client.query(`INSERT INTO activity_associations (activity_id, organization_id) VALUES ($1, $2)`, [activity!.id, organizationId]);

    const result = await recovery.recoverTimeline(candidate(historySource, "history", "act-history-1", {
      id: "act-history-1", regarding: "E-mail sent", details: "Proposal package sent", startTime: "2025-04-16T14:30:00Z",
    }));
    expect(result.state).toBe("recovered");
    expect((await client.query(`SELECT count(*)::int AS count FROM activity_associations WHERE activity_id = $1`, [activity!.id])).rows).toEqual([{ count: 2 }]);
  });

  it("uses an explicit Recovery Review parent assignment on retry without inventing fuzzy ownership", async () => {
    const sourceId = "10000000-0000-4000-8000-000000000040";
    await client.query(
      `INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES ($1, $2, 'history', 'act-history-reviewed')`,
      [sourceId, databaseKey],
    );
    const reviewed = candidate(sourceId, "history", "act-history-reviewed", {
      id: "act-history-reviewed", regarding: "Called office", details: "Asked for spring follow-up", startTime: "2025-03-01T12:00:00Z",
    });
    await client.query(
      `INSERT INTO act_archive_recovery_decisions
        (run_id, source_record_id, source_version_id, decision, target_entity_type, target_entity_id, decided_by)
       VALUES ($1, $2, $3, 'assign_parent', 'organization', $4, 'owner')`,
      [reviewed.runId, reviewed.sourceRecordId, reviewed.sourceVersionId, organizationId],
    );

    const result = await recovery.recoverTimeline(reviewed);

    expect(result).toEqual(expect.objectContaining({
      state: "recovered",
      targetSummary: expect.objectContaining({ manuallyAssigned: true, parentCount: 1 }),
    }));
    expect((await client.query(
      `SELECT association.organization_id
       FROM activity_associations association
       JOIN activities activity ON activity.id = association.activity_id
       WHERE activity.source_record_id = $1`,
      [sourceId],
    )).rows).toEqual([{ organization_id: organizationId }]);
  });

  it("keeps meaningful unplaceable history for review and drops truly blank history", async () => {
    const orphanId = "10000000-0000-4000-8000-000000000030";
    const blankId = "10000000-0000-4000-8000-000000000031";
    await client.query(`INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES ($1, $3, 'history', $2), ($4, $3, 'history', $5)`, [
      orphanId, "act-history-orphan", databaseKey, blankId, "act-history-blank",
    ]);
    expect((await recovery.recoverTimeline(candidate(orphanId, "history", "act-history-orphan", {
      id: "act-history-orphan", regarding: "Called office", startTime: "2025-01-01T12:00:00Z",
    }))).state).toBe("needs_review");
    expect((await recovery.recoverTimeline(candidate(blankId, "history", "act-history-blank", {
      id: "act-history-blank", details: "",
    }))).state).toBe("dropped_unusable");
  });
});
