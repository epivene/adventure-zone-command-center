import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";
import { ActArchiveRecoveryWorker } from "./recovery-worker";
import { DrizzleActArchiveRecoveryRepository } from "./recovery-repository";
import { ActRecoverySourceLinkResolver } from "./source-link-resolver";
import { ActEntityRecovery } from "./entity-recovery";
import { ActRelationshipRecovery } from "./relationship-recovery";
import { ActTimelineRecovery } from "./timeline-recovery";
import { ActRecoveryReviewService } from "./review-service";
import { sixteenStreetFairFixture as fixture } from "./fixtures/16th-street-fair";

let client: PGlite;
let database: ReturnType<typeof drizzle>;
let repository: DrizzleActArchiveRecoveryRepository;
let worker: ActArchiveRecoveryWorker;
let review: ActRecoveryReviewService;

async function createSchema() {
  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY,
      source_database_key text NOT NULL,
      stream_type text NOT NULL,
      act_record_id text,
      latest_version_id uuid,
      relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE act_source_record_versions (
      id uuid PRIMARY KEY,
      source_record_id uuid NOT NULL,
      raw_snapshot jsonb NOT NULL,
      UNIQUE (id, source_record_id)
    );
    CREATE TABLE act_archive_recovery_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_database_key text NOT NULL,
      requested_by text NOT NULL,
      request_key text NOT NULL,
      state text NOT NULL DEFAULT 'running',
      candidate_count integer NOT NULL DEFAULT 0,
      completed_at timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_database_key, request_key)
    );
    CREATE TABLE act_archive_recovery_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      source_record_id uuid NOT NULL,
      source_version_id uuid NOT NULL,
      stream_type text NOT NULL,
      priority integer NOT NULL,
      state text NOT NULL DEFAULT 'pending',
      target_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      attempt_count integer NOT NULL DEFAULT 0,
      last_error_code text,
      retry_after timestamptz,
      lease_owner text,
      lease_token uuid,
      lease_expires_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (run_id, source_record_id)
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

    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      place_type text NOT NULL DEFAULT 'company',
      phone text,
      normalized_phone text,
      website text,
      act_industry text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      last_resort boolean NOT NULL DEFAULT false,
      last_resort_reason text,
      act_record_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organization_locations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid,
      label text,
      city text,
      region text
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY,
      first_name text NOT NULL DEFAULT '',
      last_name text NOT NULL DEFAULT '',
      email text,
      phone text,
      normalized_phone text,
      job_title text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      act_record_id text,
      organization_location_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organization_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      contact_id uuid NOT NULL,
      role text,
      is_primary boolean NOT NULL DEFAULT false,
      source text NOT NULL DEFAULT 'manual',
      active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid,
      name text NOT NULL,
      primary_contact_id uuid,
      city text NOT NULL DEFAULT '',
      region text NOT NULL DEFAULT '',
      starts_at timestamptz,
      ends_at timestamptz,
      status text NOT NULL DEFAULT 'lead',
      probability text NOT NULL DEFAULT 'possible',
      notes text,
      act_record_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
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
      organization_location_id uuid,
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
    CREATE TABLE follow_ups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid,
      contact_id uuid,
      booking_id uuid,
      kind text NOT NULL,
      due_at timestamptz NOT NULL,
      completed_at timestamptz
    );
    CREATE TABLE calling_lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      kind text NOT NULL DEFAULT 'static',
      source_status text
    );
    CREATE TABLE calling_list_memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      calling_list_id uuid NOT NULL,
      contact_id uuid NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      source_entity_type text NOT NULL,
      act_record_id text NOT NULL,
      source_database_key text,
      source_record_id uuid,
      is_primary boolean NOT NULL DEFAULT false,
      sync_mode text NOT NULL DEFAULT 'pull_only'
    );
    CREATE TABLE audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      action text NOT NULL,
      before jsonb,
      after jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function insertSource(input: {
  id: string;
  versionId?: string;
  streamType: string;
  actRecordId?: string;
  rawSnapshot?: Record<string, unknown>;
  relationshipEvidence?: Record<string, unknown>;
}) {
  await client.query(
    `INSERT INTO act_source_records
       (id, source_database_key, stream_type, act_record_id, latest_version_id, relationship_evidence)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.id,
      fixture.sourceDatabaseKey,
      input.streamType,
      input.actRecordId ?? null,
      input.versionId ?? null,
      JSON.stringify(input.relationshipEvidence ?? {}),
    ],
  );
  if (input.versionId) {
    await client.query(
      `INSERT INTO act_source_record_versions (id, source_record_id, raw_snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [input.versionId, input.id, JSON.stringify(input.rawSnapshot ?? {})],
    );
  }
}

async function seedArchiveAndCrm() {
  await client.query(
    `INSERT INTO organizations (id, name, city, region, act_record_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      fixture.organization.id,
      fixture.organization.name,
      fixture.organization.city,
      fixture.organization.region,
      fixture.organization.companyActRecordId,
    ],
  );
  await client.query(
    `INSERT INTO contacts (id, first_name, last_name, email, act_record_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      fixture.contact.id,
      fixture.contact.firstName,
      fixture.contact.lastName,
      fixture.contact.email,
      fixture.contact.contactActRecordId,
    ],
  );
  await client.query(
    `INSERT INTO organization_contacts (organization_id, contact_id, is_primary, source, active)
     VALUES ($1, $2, true, 'act_recovery_fixture', true)`,
    [fixture.organization.id, fixture.contact.id],
  );

  await insertSource({
    id: fixture.organization.companySourceRecordId,
    versionId: fixture.organization.companySourceVersionId,
    streamType: "company",
    actRecordId: fixture.organization.companyActRecordId,
    rawSnapshot: {
      id: fixture.organization.companyActRecordId,
      name: fixture.organization.name,
      city: fixture.organization.city,
      state: fixture.organization.region,
    },
  });
  await insertSource({
    id: fixture.contact.contactSourceRecordId,
    versionId: fixture.contact.contactSourceVersionId,
    streamType: "contact",
    actRecordId: fixture.contact.contactActRecordId,
    rawSnapshot: {
      id: fixture.contact.contactActRecordId,
      firstName: fixture.contact.firstName,
      lastName: fixture.contact.lastName,
      emailAddress: fixture.contact.email,
    },
  });

  await client.query(
    `INSERT INTO act_external_links
       (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id, is_primary, sync_mode)
     VALUES
       ('organization', $1, 'company', $2, $5, $3, true, 'pull_only'),
       ('contact', $4, 'contact', $6, $5, $7, true, 'pull_only')`,
    [
      fixture.organization.id,
      fixture.organization.companyActRecordId,
      fixture.organization.companySourceRecordId,
      fixture.contact.id,
      fixture.sourceDatabaseKey,
      fixture.contact.contactActRecordId,
      fixture.contact.contactSourceRecordId,
    ],
  );

  for (const history of fixture.histories) {
    await insertSource({
      id: history.sourceRecordId,
      versionId: history.sourceVersionId,
      streamType: "history",
      actRecordId: history.actRecordId,
      rawSnapshot: {
        id: history.actRecordId,
        regarding: history.regarding,
        details: history.details,
        startTime: history.startTime,
      },
    });
    for (const parent of history.parents) {
      const isCompany = parent === "company";
      await insertSource({
        id: crypto.randomUUID(),
        streamType: isCompany ? "history_company" : "history_contact",
        relationshipEvidence: {
          parentKind: "history",
          parentActRecordId: history.actRecordId,
          targetKind: isCompany ? "company" : "contact",
          targetActRecordId: isCompany
            ? fixture.organization.companyActRecordId
            : fixture.contact.contactActRecordId,
        },
      });
    }
  }
}

async function runUntilIdle(runId: string) {
  let now = new Date("2026-08-16T15:00:00.000Z");
  for (let step = 0; step < 100; step += 1) {
    const result = await worker.runOne({ workerId: "16th-street-fair-e2e", now });
    now = new Date(now.getTime() + 1000);
    if (result.kind === "idle") return;
  }
  throw new Error(`ACT recovery did not drain run ${runId}`);
}

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client);
  await createSchema();
  await seedArchiveAndCrm();

  repository = new DrizzleActArchiveRecoveryRepository(database as never);
  const resolver = new ActRecoverySourceLinkResolver(database as never);
  worker = new ActArchiveRecoveryWorker({
    repository,
    entityRecovery: new ActEntityRecovery(database as never, resolver),
    relationshipRecovery: new ActRelationshipRecovery(database as never, resolver),
    timelineRecovery: new ActTimelineRecovery(database as never, resolver),
  });
  review = new ActRecoveryReviewService(database as never, repository);
});

afterAll(async () => {
  await client.close();
});

describe("16th Street Fair ACT archive recovery", () => {
  it("recovers all seven archived histories onto the event profile exactly once", async () => {
    expect((await client.query(
      `SELECT count(*)::int AS count FROM act_source_records
       WHERE source_database_key = $1 AND stream_type = 'history' AND latest_version_id IS NOT NULL`,
      [fixture.sourceDatabaseKey],
    )).rows).toEqual([{ count: 7 }]);

    const created = await repository.createOrGetRun({
      sourceDatabaseKey: fixture.sourceDatabaseKey,
      requestKey: "16th-street-fair-e2e",
      requestedBy: "test-owner",
      now: new Date("2026-08-16T15:00:00.000Z"),
    });
    await runUntilIdle(created.runId);

    const status = await review.status({ runId: created.runId });
    expect(status.retryableFailed).toBe(0);
    expect(status.pending).toBe(0);
    expect(status.leased).toBe(0);
    expect(status.candidateCount).toBe(status.checkedCount);
    expect(status.candidateCount).toBe(
      status.alreadyPresent + status.recovered + status.needsReview + status.droppedUnusable,
    );
    expect(status.byStreamType.history).toMatchObject({
      candidateCount: 7,
      recovered: 7,
      needsReview: 0,
      retryableFailed: 0,
    });

    const activityRows = (await client.query<{ body: string; occurred_at: Date; source_type: string }>(
      `SELECT activities.body, activities.occurred_at, activities.source_type
       FROM activities
       INNER JOIN activity_associations associations ON associations.activity_id = activities.id
       WHERE associations.organization_id = $1
       ORDER BY activities.occurred_at DESC, activities.id`,
      [fixture.organization.id],
    )).rows;
    expect(activityRows).toHaveLength(7);
    expect(activityRows.map(({ body }) => body)).toEqual(
      expect.arrayContaining(fixture.histories.map(({ details }) => details)),
    );
    expect(activityRows.every(({ source_type }) => source_type === "history")).toBe(true);
    expect(activityRows.some(({ occurred_at }) =>
      occurred_at.toISOString() === "2025-04-16T14:30:00.000Z",
    )).toBe(true);

    const profile = await new DrizzleEventProfileRepository(database as never)
      .getEventProfile(fixture.organization.id);
    expect(profile?.place.name).toBe("16th Street Fair (Denver) CO");
    expect(profile?.contacts.map(({ name }) => name)).toContain("Downtown Denver");
    expect(profile?.notes).toHaveLength(7);
    expect(profile?.notes.every(({ importedFromAct, actSourceType }) =>
      importedFromAct && actSourceType === "history",
    )).toBe(true);

    const replay = await repository.createOrGetRun({
      sourceDatabaseKey: fixture.sourceDatabaseKey,
      requestKey: "16th-street-fair-e2e",
      requestedBy: "test-owner",
      now: new Date("2026-08-16T16:00:00.000Z"),
    });
    expect(replay.runId).toBe(created.runId);
    await expect(worker.runOne({
      workerId: "16th-street-fair-e2e-replay",
      now: new Date("2026-08-16T16:00:01.000Z"),
    })).resolves.toEqual({ kind: "idle" });
    expect((await client.query(
      `SELECT count(*)::int AS count FROM activities WHERE source_type = 'history'`,
    )).rows).toEqual([{ count: 7 }]);

    const attachmentCandidates = (await client.query(
      `SELECT count(*)::int AS count FROM act_source_records
       WHERE source_database_key = $1 AND stream_type IN ('attachment', 'document')`,
      [fixture.sourceDatabaseKey],
    )).rows;
    expect(attachmentCandidates).toEqual([{ count: 0 }]);
  });
});
