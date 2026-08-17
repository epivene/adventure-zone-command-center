import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import { ActTimelineRecovery } from "./timeline-recovery";
import type { RecoveryCandidate } from "./recovery-types";

let client: PGlite;
let recovery: ActTimelineRecovery;

beforeEach(async () => {
  client = new PGlite();
  const database = drizzle(client);
  recovery = new ActTimelineRecovery(
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
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
      source_record_id uuid NOT NULL, source_version_id uuid NOT NULL,
      decision text NOT NULL, target_entity_type text, target_entity_id uuid,
      decided_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE contacts (id uuid PRIMARY KEY);
    CREATE TABLE bookings (id uuid PRIMARY KEY);
    CREATE TABLE activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
      contact_id uuid, booking_id uuid, kind text NOT NULL, subject text,
      status text, body text NOT NULL, occurred_at timestamptz,
      timeline_sort_at timestamptz NOT NULL, date_is_import_fallback boolean NOT NULL DEFAULT false,
      ends_at timestamptz, act_record_id text UNIQUE, source_record_id uuid,
      source_version_id uuid, source_type text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE activity_associations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), activity_id uuid NOT NULL,
      organization_id uuid, contact_id uuid, booking_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
});

afterEach(async () => client.close());

describe("ACT timeline recovery bookkeeping policy", () => {
  it("drops pure link bookkeeping before creating an activity or association", async () => {
    const candidate: RecoveryCandidate = {
      itemId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      sourceRecordId: crypto.randomUUID(),
      sourceVersionId: crypto.randomUUID(),
      streamType: "history",
      actRecordId: "history-link-1",
      rawSnapshot: {
        id: "history-link-1",
        details: "Contact Downtown Denver linked",
        startTime: "2023-01-11T12:00:00Z",
      },
      relationshipEvidence: {},
      leaseToken: crypto.randomUUID(),
      capturedAt: "2026-08-16T18:00:00Z",
    };

    const result = await recovery.recoverTimeline(candidate);

    expect(result).toEqual({
      state: "dropped_unusable",
      targetSummary: {
        reason: "act_bookkeeping_purged",
        purgeReason: "relationship_bookkeeping",
        policyVersion: "2026-08-16-v1",
      },
    });
    expect((await client.query("select count(*)::int as count from activities")).rows)
      .toEqual([{ count: 0 }]);
    expect((await client.query("select count(*)::int as count from activity_associations")).rows)
      .toEqual([{ count: 0 }]);
  });
});
