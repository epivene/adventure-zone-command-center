import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import { ActTimelineRecovery } from "./timeline-recovery";
import type { RecoveryCandidate } from "./recovery-types";

const databaseKey = "inline-history-recovery";
const organizationId = "20000000-0000-4000-8000-000000000001";
const contactId = "20000000-0000-4000-8000-000000000002";
const companySourceId = "10000000-0000-4000-8000-000000000001";
const contactSourceId = "10000000-0000-4000-8000-000000000002";
const historySourceId = "10000000-0000-4000-8000-000000000010";

let client: PGlite;
let recovery: ActTimelineRecovery;

function historyCandidate(): RecoveryCandidate {
  return {
    itemId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    sourceRecordId: historySourceId,
    sourceVersionId: crypto.randomUUID(),
    streamType: "history",
    actRecordId: "act-history-inline-1",
    rawSnapshot: {
      id: "act-history-inline-1",
      regarding: "E-mail sent",
      details: "Proposal package sent",
      startTime: "2025-04-16T14:30:00Z",
      company: { id: "act-company-1", name: "16th Street Fair (Denver) CO" },
      contact: { id: "act-contact-1", firstName: "Downtown", lastName: "Denver" },
    },
    relationshipEvidence: {},
    leaseToken: crypto.randomUUID(),
    capturedAt: "2026-08-08T12:00:00Z",
  };
}

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  recovery = new ActTimelineRecovery(database as never, new ActRecoverySourceLinkResolver(database as never));
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
    CREATE UNIQUE INDEX activity_assoc_contact_unique ON activity_associations(activity_id, contact_id) WHERE contact_id IS NOT NULL;
    CREATE UNIQUE INDEX activity_assoc_booking_unique ON activity_associations(activity_id, booking_id) WHERE booking_id IS NOT NULL;

    INSERT INTO organizations (id) VALUES ('${organizationId}');
    INSERT INTO contacts (id) VALUES ('${contactId}');
    INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id) VALUES
      ('${companySourceId}', '${databaseKey}', 'company', 'act-company-1'),
      ('${contactSourceId}', '${databaseKey}', 'contact', 'act-contact-1'),
      ('${historySourceId}', '${databaseKey}', 'history', 'act-history-inline-1');
    INSERT INTO act_external_links
      (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
    VALUES
      ('organization', '${organizationId}', 'company', 'act-company-1', '${databaseKey}', '${companySourceId}'),
      ('contact', '${contactId}', 'contact', 'act-contact-1', '${databaseKey}', '${contactSourceId}');
  `);
});

afterEach(async () => client.close());

describe("ACT timeline recovery from inline relationship evidence", () => {
  it("attaches history using inline company/contact IDs when separate relationship rows were never archived", async () => {
    const result = await recovery.recoverTimeline(historyCandidate());

    expect(result.state).toBe("recovered");
    expect(result.targetSummary).toEqual(expect.objectContaining({ parentCount: 2 }));
    expect((await client.query(
      `SELECT association.organization_id, association.contact_id
       FROM activity_associations association
       JOIN activities activity ON activity.id = association.activity_id
       WHERE activity.source_record_id = $1
       ORDER BY association.organization_id NULLS LAST, association.contact_id NULLS LAST`,
      [historySourceId],
    )).rows).toEqual([
      { organization_id: organizationId, contact_id: null },
      { organization_id: null, contact_id: contactId },
    ]);
  });
});
