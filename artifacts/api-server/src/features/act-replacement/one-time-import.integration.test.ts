import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { db as ApplicationDatabase } from "@/db/client";
import * as schema from "@workspace/db/schema";
import { ActApplyCoordinator } from "./apply-coordinator";
import { ActApplyService } from "./apply-service";
import { DrizzleApplyRepository } from "./drizzle-apply-repository";
import { ProductionActOrganizer } from "./production-organizer";
import {
  DrizzleActReviewCommandStore,
  DrizzleActReviewReader,
  DrizzleProductionOrganizerStore,
} from "./review-sql-adapter";
import { ReviewCommandService, type AutomaticReviewCommandResult } from "./review-command-service";

function completedAutomaticReview(result: AutomaticReviewCommandResult) {
  expect(result.status).toBe("complete");
  if (result.status !== "complete") throw new Error("automatic_review_not_complete");
  return result;
}

type QueryResult<Row> = { rows: Row[] };
type TestPool = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

const schemaName = `act_one_time_import_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schemaName}"`;
const databaseKey = `one-time-import-${randomUUID()}`;
const scope = { sourceDatabaseKey: databaseKey, requestedBy: "owner" };
const duplicateANoiseLastNames = Array.from(
  { length: 24 },
  (_, index) => `Natalie Duplicate Noise ${String(index + 1).padStart(2, "0")}`,
);
const duplicateZNoiseLastNames = Array.from(
  { length: 6 },
  (_, index) => `Natalie Duplicate Noise ${String(index + 25).padStart(2, "0")}`,
);
let cleanupPool: TestPool | undefined;

async function poolConstructor() {
  const pgModuleUrl = new URL(
    "../../../../../lib/db/node_modules/pg/lib/index.js",
    import.meta.url,
  );
  const pgModule = (await import(pgModuleUrl.href)) as {
    default: {
      Pool: new (config: {
        connectionString: string;
        options: string;
      }) => TestPool;
    };
  };
  return pgModule.default.Pool;
}

async function createPool() {
  const Pool = await poolConstructor();
  return new Pool({
    connectionString: process.env.TEST_DATABASE_URL!,
    options: `-c search_path=${schemaName},public`,
  });
}

async function installDisposableSchema(pool: TestPool) {
  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  await pool.query(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
      act_record_id text UNIQUE, phone text, address_1 text, city text,
      address_2 text, region text, postal_code text, website text, act_industry text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
      first_name text NOT NULL, last_name text NOT NULL, email text, phone text,
      job_title text, address_1 text, address_2 text, city text, region text, postal_code text,
      act_record_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
      organization_id uuid REFERENCES organizations(id), city text NOT NULL,
      region text NOT NULL, venue_name text, notes text,
      starts_at timestamptz, ends_at timestamptz,
      status text, probability integer,
      act_record_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE calling_lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, kind text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organization_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
      contact_id uuid NOT NULL REFERENCES contacts(id), active boolean NOT NULL DEFAULT true,
      UNIQUE (organization_id, contact_id)
    );
    CREATE TABLE booking_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
      contact_id uuid NOT NULL REFERENCES contacts(id), UNIQUE (booking_id, contact_id)
    );
    CREATE TABLE calling_list_memberships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), calling_list_id uuid NOT NULL REFERENCES calling_lists(id),
      contact_id uuid NOT NULL REFERENCES contacts(id), source text NOT NULL DEFAULT 'act_migration',
      CONSTRAINT calling_list_memberships_source_valid CHECK (source IN ('act_migration','manual')),
      UNIQUE (calling_list_id, contact_id)
    );
    CREATE TABLE activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
      contact_id uuid REFERENCES contacts(id), booking_id uuid REFERENCES bookings(id),
      kind text NOT NULL, body text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT activities_parent_required CHECK (
        organization_id IS NOT NULL OR contact_id IS NOT NULL OR booking_id IS NOT NULL
      )
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL,
      entity_id uuid NOT NULL, source_entity_type text NOT NULL, act_record_id text NOT NULL
    );
    CREATE UNIQUE INDEX act_external_links_source_external_id_unique
      ON act_external_links(source_entity_type, act_record_id);
  `);
  for (const migration of [
    "006_act_replacement_archive.sql",
    "007_act_replacement_organize_apply.sql",
    "012_act_apply_batch_leases.sql",
    "013_act_approval_apply_contract.sql",
    "014_act_review_bulk_decisions.sql",
    "015_act_bulk_review_requests.sql",
    "016_act_review_conflict_proof.sql",
    "017_act_relationship_parent_decisions.sql",
    "018_act_review_decision_integrity.sql",
    "019_act_approval_provenance.sql",
    "020_act_automatic_review_recovery.sql",
    "021_act_manifest_digest_version.sql",
    "022_act_manifest_generation.sql",
  ]) {
    const path = fileURLToPath(
      new URL(`../../../../../lib/db/migrations/${migration}`, import.meta.url),
    );
    await pool.query(await readFile(path, "utf8"));
  }
}

async function seedArchivedActRun(pool: TestPool) {
  const run = await pool.query<{ id: string }>(
    `INSERT INTO act_replacement_runs
       (request_key, source_database_key, requested_by, page_size, phase)
     VALUES ($1, $2, 'owner', 25, 'extract_complete') RETURNING id`,
    [`one-time-${randomUUID()}`, databaseKey],
  );
  const runId = run.rows[0]!.id;
  const archived = [
    {
      streamType: "company",
      sourceKey: "company-1",
      actRecordId: "company-act-1",
      raw: { Name: "Adventure Zone" },
      relationshipEvidence: {},
    },
    ...Array.from({ length: 27 }, (_, index) => ({
      streamType: "company",
      sourceKey: `company-extra-${index + 1}`,
      actRecordId: `company-extra-act-${index + 1}`,
      raw: { Name: `Adventure Zone ${index + 1}` },
      relationshipEvidence: {},
    })),
    {
      streamType: "contact",
      sourceKey: "contact-1",
      actRecordId: "contact-act-1",
      raw: { FirstName: "Taako", LastName: "Taaco" },
      relationshipEvidence: {},
    },
    {
      streamType: "company_contact",
      sourceKey: "company-contact-1",
      actRecordId: null,
      raw: {},
      relationshipEvidence: {
        source: "endpoint",
        parentKind: "contact",
        parentActRecordId: "contact-act-1",
        targetKind: "company",
        targetActRecordId: "company-act-1",
      },
    },
  ];
  for (const source of archived) {
    const record = await pool.query<{ id: string }>(
      `INSERT INTO act_source_records
         (source_database_key, stream_type, source_key, act_record_id,
          first_seen_run_id, last_seen_run_id, relationship_evidence,
          archive_completeness)
       VALUES ($1, $2, $3, $4, $5, $5, $6::jsonb, 'complete') RETURNING id`,
      [
        databaseKey,
        source.streamType,
        source.sourceKey,
        source.actRecordId,
        runId,
        JSON.stringify(source.relationshipEvidence),
      ],
    );
    const sourceRecordId = record.rows[0]!.id;
    const version = await pool.query<{ id: string }>(
      `INSERT INTO act_source_record_versions
         (source_record_id, source_database_key, fingerprint, raw_snapshot,
          snapshot_scope, observed_run_id)
       VALUES ($1, $2, $3, $4::jsonb, 'detail', $5) RETURNING id`,
      [
        sourceRecordId,
        databaseKey,
        `${source.sourceKey}-fingerprint`,
        JSON.stringify(source.raw),
        runId,
      ],
    );
    const versionId = version.rows[0]!.id;
    await pool.query(
      `UPDATE act_source_records SET latest_version_id = $1, latest_fingerprint = $2 WHERE id = $3`,
      [versionId, `${source.sourceKey}-fingerprint`, sourceRecordId],
    );
    await pool.query(
      `INSERT INTO act_replacement_observations
         (run_id, source_database_key, source_record_id, version_id, snapshot_scope)
       VALUES ($1, $2, $3, $4, 'detail')`,
      [runId, databaseKey, sourceRecordId, versionId],
    );
  }
  return runId;
}

type ArchivedReviewSeed = {
  key: string;
  streamType: string;
  actRecordId?: string | null;
  raw: Record<string, unknown>;
  relationshipEvidence?: Record<string, unknown>;
};

async function seedAutomaticReviewRun(pool: TestPool, seeds: readonly ArchivedReviewSeed[]) {
  await pool.query(
    `UPDATE act_replacement_runs
     SET phase = 'superseded', superseded_at = now()
     WHERE source_database_key = $1
       AND phase IN ('extracting', 'extract_complete', 'organizing', 'ready_to_apply', 'applying')`,
    [databaseKey],
  );
  const run = await pool.query<{ id: string }>(
    `INSERT INTO act_replacement_runs
       (request_key, source_database_key, requested_by, page_size, phase)
     VALUES ($1, $2, 'owner', 25, 'extract_complete') RETURNING id`,
    [`automatic-${randomUUID()}`, databaseKey],
  );
  const runId = run.rows[0]!.id;
  const ids = new Map<string, { sourceRecordId: string; sourceVersionId: string }>();
  for (const seed of seeds) {
    const record = await pool.query<{ id: string }>(
      `INSERT INTO act_source_records
         (source_database_key, stream_type, source_key, act_record_id,
          first_seen_run_id, last_seen_run_id, relationship_evidence, archive_completeness)
       VALUES ($1, $2, $3, $4, $5, $5, $6::jsonb, 'complete') RETURNING id`,
      [databaseKey, seed.streamType, `${seed.key}-${randomUUID()}`, seed.actRecordId ?? null, runId, JSON.stringify(seed.relationshipEvidence ?? {})],
    );
    const sourceRecordId = record.rows[0]!.id;
    const fingerprint = `${seed.key}-${randomUUID()}`;
    const version = await pool.query<{ id: string }>(
      `INSERT INTO act_source_record_versions
         (source_record_id, source_database_key, fingerprint, raw_snapshot, snapshot_scope, observed_run_id)
       VALUES ($1, $2, $3, $4::jsonb, 'detail', $5) RETURNING id`,
      [sourceRecordId, databaseKey, fingerprint, JSON.stringify(seed.raw), runId],
    );
    const sourceVersionId = version.rows[0]!.id;
    await pool.query(
      `UPDATE act_source_records SET latest_version_id = $1, latest_fingerprint = $2 WHERE id = $3`,
      [sourceVersionId, fingerprint, sourceRecordId],
    );
    await pool.query(
      `INSERT INTO act_replacement_observations
         (run_id, source_database_key, source_record_id, version_id, snapshot_scope)
       VALUES ($1, $2, $3, $4, 'detail')`,
      [runId, databaseKey, sourceRecordId, sourceVersionId],
    );
    ids.set(seed.key, { sourceRecordId, sourceVersionId });
  }
  return { runId, ids };
}

async function startTestRuntime() {
  const pool = await createPool();
  const database = drizzle(pool as never, {
    schema,
  }) as unknown as typeof ApplicationDatabase;
  const reader = new DrizzleActReviewReader(database, scope);
  const applyRepository = new DrizzleApplyRepository(database, {
    manifestDigest: async (runId) =>
      (await reader.getManifest(runId))?.digest ?? null,
  });
  const applyService = new ActApplyService(applyRepository, true);
  const commandStore = new DrizzleActReviewCommandStore(
    database,
    scope,
    applyService,
  );
  return {
    pool,
    db: database,
    reader,
    commandStore,
    organizer: new ProductionActOrganizer(
      new DrizzleProductionOrganizerStore(database, scope),
    ),
    approval: new ReviewCommandService(commandStore),
    coordinator: new ActApplyCoordinator(applyService, applyRepository),
    close: () => pool.end(),
  };
}

async function archivedRunSnapshot(pool: TestPool, runId: string) {
  const snapshot = await pool.query<{
    table_name: string;
    row_count: number;
    byte_count: number;
    content_digest: string;
  }>(`
    WITH observed_sources AS (
      SELECT DISTINCT source_record_id
      FROM act_replacement_observations
      WHERE run_id = $1
    ), archive_rows AS (
      SELECT 'act_source_records'::text AS table_name, row_to_json(source_row)::text AS row_value
      FROM (
        SELECT source.*
        FROM act_source_records source
        JOIN observed_sources observed ON observed.source_record_id = source.id
      ) source_row
      UNION ALL
      SELECT 'act_source_record_versions', row_to_json(version_row)::text
      FROM (
        SELECT version.*
        FROM act_source_record_versions version
        JOIN observed_sources observed ON observed.source_record_id = version.source_record_id
      ) version_row
      UNION ALL
      SELECT 'act_replacement_observations', row_to_json(observation_row)::text
      FROM (
        SELECT observation.*
        FROM act_replacement_observations observation
        WHERE observation.run_id = $1
      ) observation_row
    )
    SELECT table_name,
      count(*)::int AS row_count,
      coalesce(sum(octet_length(row_value)), 0)::int AS byte_count,
      md5(coalesce(string_agg(row_value, E'\n' ORDER BY row_value), '')) AS content_digest
    FROM archive_rows
    GROUP BY table_name
    ORDER BY table_name
  `, [runId]);
  return snapshot.rows;
}

async function importedProfileCounts(pool: TestPool, actRecordIds: readonly string[]) {
  const counts = await pool.query<{
    organizations: number;
    contacts: number;
    source_links: number;
  }>(`SELECT
    (SELECT count(*)::int FROM organizations WHERE act_record_id = ANY($1::text[])) AS organizations,
    (SELECT count(*)::int FROM contacts WHERE act_record_id = ANY($1::text[])) AS contacts,
    (SELECT count(*)::int FROM act_external_links WHERE act_record_id = ANY($1::text[])) AS source_links`,
  [actRecordIds]);
  return counts.rows[0]!;
}

async function targetTableSnapshot(pool: TestPool) {
  const snapshot = await pool.query<{
    table_name: string;
    row_count: number;
    byte_count: number;
    content_digest: string;
  }>(`
    WITH target_rows AS (
      SELECT 'organizations'::text AS table_name, row_to_json(value)::text AS row_value FROM (SELECT * FROM organizations) value
      UNION ALL
      SELECT 'contacts', row_to_json(value)::text FROM (SELECT * FROM contacts) value
      UNION ALL
      SELECT 'organization_contacts', row_to_json(value)::text FROM (SELECT * FROM organization_contacts) value
      UNION ALL
      SELECT 'act_external_links', row_to_json(value)::text FROM (SELECT * FROM act_external_links) value
    )
    SELECT table_name,
      count(*)::int AS row_count,
      coalesce(sum(octet_length(row_value)), 0)::int AS byte_count,
      md5(coalesce(string_agg(row_value, E'\n' ORDER BY row_value), '')) AS content_digest
    FROM target_rows
    GROUP BY table_name
    ORDER BY table_name
  `);
  return snapshot.rows;
}

async function contactSnapshot(pool: TestPool, contactId: string) {
  const result = await pool.query<{
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
    job_title: string | null;
    act_record_id: string | null;
  }>(`SELECT id, first_name, last_name, email, phone, job_title, act_record_id
      FROM contacts WHERE id = $1`, [contactId]);
  return result.rows[0]!;
}

async function importedProfileSnapshot(pool: TestPool, actRecordIds: readonly string[]) {
  const result = await pool.query<{ kind: string; value: Record<string, unknown> }>(`
    SELECT kind, value FROM (
      SELECT 'organization'::text AS kind,
        jsonb_build_object('id', id, 'name', name, 'actRecordId', act_record_id, 'phone', phone, 'website', website) AS value
      FROM organizations WHERE act_record_id = ANY($1::text[])
      UNION ALL
      SELECT 'contact',
        jsonb_build_object('id', id, 'firstName', first_name, 'lastName', last_name, 'email', email,
          'phone', phone, 'jobTitle', job_title, 'actRecordId', act_record_id)
      FROM contacts WHERE act_record_id = ANY($1::text[])
      UNION ALL
      SELECT 'external_link',
        jsonb_build_object('id', id, 'entityType', entity_type, 'entityId', entity_id,
          'sourceEntityType', source_entity_type, 'actRecordId', act_record_id, 'sourceRecordId', source_record_id)
      FROM act_external_links WHERE act_record_id = ANY($1::text[])
    ) snapshots
    ORDER BY kind, value::text
  `, [actRecordIds]);
  return result.rows;
}

async function automaticDurableIds(pool: TestPool, runId: string, requestKey: string) {
  const decisions = await pool.query<{ id: string }>(`
    SELECT decision.id::text AS id
    FROM act_replacement_review_decisions decision
    JOIN act_replacement_outcomes outcome ON outcome.source_record_id = decision.source_record_id
    WHERE outcome.run_id = $1
    ORDER BY decision.id`, [runId]);
  const requests = await pool.query<{ id: string }>(`
    SELECT id::text AS id FROM act_replacement_bulk_review_requests
    WHERE run_id = $1 AND request_key = $2
    ORDER BY id`, [runId, requestKey]);
  return {
    decisionIds: decisions.rows.map((row) => row.id),
    distinctDecisionIds: new Set(decisions.rows.map((row) => row.id)).size,
    requestIds: requests.rows.map((row) => row.id),
    distinctRequestIds: new Set(requests.rows.map((row) => row.id)).size,
  };
}

async function disposableSchemaPool() {
  if (cleanupPool) return cleanupPool;
  cleanupPool = await createPool();
  await installDisposableSchema(cleanupPool);
  return cleanupPool;
}

async function applyAllInBatches(
  coordinator: ActApplyCoordinator,
  input: {
    runId: string;
    manifestDigest: string;
    approvalRequestKey: string;
  },
) {
  let calls = 0;
  for (;;) {
    const result = await coordinator.applyNext({
      runId: input.runId,
      expectedManifestDigest: input.manifestDigest,
      approvalRequestKey: input.approvalRequestKey,
      requestedBy: "owner",
      batchSize: 25,
    });
    calls += 1;
    expect(result.batch.failedCount).toBe(0);
    expect(result.batch.blockedCount).toBe(0);
    if (!result.hasMore) break;
  }
  return calls;
}

afterAll(async () => {
  if (!cleanupPool) return;
  await cleanupPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await cleanupPool.end();
});

describe("one-time Act import on disposable PostgreSQL", () => {
  it("places one exact duplicate inside and one just outside the legacy 25-row substring window", () => {
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const target = normalize("Natalie Duplicate");
    const labels = [
      ...duplicateANoiseLastNames.map((lastName) => normalize(`A ${lastName}`)),
      target,
      target,
      ...duplicateZNoiseLastNames.map((lastName) => normalize(`Z ${lastName}`)),
    ].sort();

    expect(labels).toHaveLength(32);
    expect(labels.every((label) => label.includes(target))).toBe(true);
    expect(labels.flatMap((label, index) => label === target ? [index + 1] : [])).toEqual([25, 26]);
  });

  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "organizes, applies, restarts, and replays without duplicates",
    async () => {
      const setupPool = await disposableSchemaPool();
      const runId = await seedArchivedActRun(setupPool);

      const firstProcess = await startTestRuntime();
      const organized = await firstProcess.organizer.organize(runId);
      const approved = await firstProcess.approval.approveSafeDefaults({
        runId,
        expectedManifestDigest: organized.manifest.digest,
        requestKey: "one-time-apply",
        requestedBy: "owner",
      });
      expect(approved.approvedOperationIds.length).toBeGreaterThan(25);
      const firstApplyCalls = await applyAllInBatches(firstProcess.coordinator, {
        runId,
        manifestDigest: organized.manifest.digest,
        approvalRequestKey: "one-time-apply",
      });
      expect(firstApplyCalls).toBeGreaterThan(1);
      await firstProcess.close();

      const secondProcess = await startTestRuntime();
      await applyAllInBatches(secondProcess.coordinator, {
        runId,
        manifestDigest: organized.manifest.digest,
        approvalRequestKey: "one-time-apply",
      });

      const entityCounts = await secondProcess.pool.query<{
        organizations: number;
        contacts: number;
        relationships: number;
      }>(`SELECT
        (SELECT count(*)::int FROM organizations) AS organizations,
        (SELECT count(*)::int FROM contacts) AS contacts,
        (SELECT count(*)::int FROM organization_contacts) AS relationships`);
      expect(entityCounts.rows[0]).toEqual({
        organizations: 28,
        contacts: 1,
        relationships: 1,
      });

      const sourceLinkCount = await secondProcess.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM act_external_links`,
      );
      expect(sourceLinkCount.rows[0]?.count).toBe(29);

      const duplicateSourceLinks = await secondProcess.pool.query<{
        count: number;
      }>(`
        SELECT count(*)::int AS count FROM (
          SELECT source_entity_type, act_record_id
          FROM act_external_links
          GROUP BY source_entity_type, act_record_id
          HAVING count(*) > 1
        ) duplicates
      `);
      expect(duplicateSourceLinks.rows[0]?.count).toBe(0);

      const unresolvedRequired = await secondProcess.pool.query<{
        count: number;
      }>(
        `
        SELECT count(*)::int AS count
        FROM act_replacement_apply_operations
        WHERE run_id = $1 AND required_for_source_outcome
          AND status NOT IN ('applied', 'already_present')
      `,
        [runId],
      );
      expect(unresolvedRequired.rows[0]?.count).toBe(0);
      await secondProcess.close();
    },
  );
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "uses a ready exact external link for field proof without a redundant identity decision",
    async () => {
      const setupPool = await disposableSchemaPool();
      const natalie = await setupPool.query<{ id: string }>(
        `INSERT INTO contacts (first_name, last_name, email, job_title)
         VALUES ('Natalie', 'Andelin', 'natalie@example.com', 'Local Director') RETURNING id`,
      );
      await setupPool.query(
        `INSERT INTO contacts (first_name, last_name, phone) VALUES
          ('Existing', 'Alpha', '555-777-8888'),
          ('Existing', 'Beta', '555-777-8888')`,
      );
      const seeded = await seedAutomaticReviewRun(setupPool, [
        {
          key: "natalie", streamType: "contact", actRecordId: "automatic-natalie",
          raw: { FirstName: "Natalie", LastName: "Andelin", EmailAddress: "natalie@example.com", JobTitle: "ACT Director" },
        },
        {
          key: "import-new", streamType: "contact", actRecordId: "automatic-import-new",
          raw: { FirstName: "Maya", LastName: "New", BusinessPhone: "555-777-8888" },
        },
        {
          key: "optional", streamType: "contact", actRecordId: "automatic-optional",
          raw: { FirstName: "Optional", LastName: "Relationship" },
        },
        {
          key: "optional-relationship", streamType: "company_contact",
          raw: {},
          relationshipEvidence: {
            source: "endpoint", parentKind: "contact", parentActRecordId: "automatic-optional",
            targetKind: "company", targetActRecordId: "missing-optional-company",
          },
        },
        {
          key: "unsupported", streamType: "contact", actRecordId: "automatic-unsupported",
          raw: { FirstName: "Missing last name" },
        },
      ]);
      await setupPool.query(
        `INSERT INTO act_external_links
           (entity_type, source_entity_type, entity_id, act_record_id,
            source_database_key, source_record_id, is_primary, sync_mode)
         VALUES ('contact', 'contact', $1, 'automatic-natalie', $2, $3, false, 'pull_only')`,
        [natalie.rows[0]!.id, databaseKey, seeded.ids.get("natalie")!.sourceRecordId],
      );
      const before = await setupPool.query<{ records: number; versions: number; observations: number }>(
        `SELECT
          (SELECT count(*)::int FROM act_source_records WHERE source_database_key = $1) AS records,
          (SELECT count(*)::int FROM act_source_record_versions WHERE source_database_key = $1) AS versions,
          (SELECT count(*)::int FROM act_replacement_observations WHERE source_database_key = $1) AS observations`,
        [databaseKey],
      );

      const runtime = await startTestRuntime();
      const organized = await runtime.organizer.organize(seeded.runId);
      const rebuild = vi.spyOn(runtime.commandStore, "rebuildAfterReviewChange");
      const request = {
        runId: seeded.runId,
        expectedManifestDigest: organized.manifest.digest,
        requestKey: "automatic-cleanup",
        requestedBy: "owner",
      };
      const first = completedAutomaticReview(await runtime.approval.resolveAutomatically(request));
      const replay = completedAutomaticReview(await runtime.approval.resolveAutomatically(request));

      expect(first.decisions).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceRecordId: seeded.ids.get("natalie")!.sourceRecordId, scope: "field_conflict", decision: "use_source", fieldName: "jobTitle" }),
        expect.objectContaining({ sourceRecordId: seeded.ids.get("import-new")!.sourceRecordId, scope: "duplicate_identity", decision: "keep_separate" }),
        expect.objectContaining({ sourceRecordId: seeded.ids.get("optional")!.sourceRecordId, scope: "relationship", decision: "keep_unlinked" }),
        expect.objectContaining({ sourceRecordId: seeded.ids.get("unsupported")!.sourceRecordId, scope: "unsupported_record", decision: "ignore_source" }),
      ]));
      expect(first.decisions).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceRecordId: seeded.ids.get("natalie")!.sourceRecordId, scope: "duplicate_identity" }),
      ]));
      expect(first.decisions).toHaveLength(4);
      expect(first.reviewedOperationIds).toHaveLength(1);
      expect(replay).toEqual(first);
      expect(rebuild).toHaveBeenCalledOnce();

      const durable = await runtime.pool.query<{
        decisions: number; requests: number; pending: number;
        records: number; versions: number; observations: number;
      }>(
        `SELECT
          (SELECT count(*)::int FROM act_replacement_review_decisions d
            JOIN act_replacement_outcomes o ON o.source_record_id = d.source_record_id
            WHERE o.run_id = $1 AND d.active) AS decisions,
          (SELECT count(*)::int FROM act_replacement_bulk_review_requests WHERE run_id = $1) AS requests,
          (SELECT count(*)::int FROM act_replacement_bulk_review_requests
            WHERE run_id = $1 AND manifest_digest = '__pending_review_rebuild__') AS pending,
          (SELECT count(*)::int FROM act_source_records WHERE source_database_key = $2) AS records,
          (SELECT count(*)::int FROM act_source_record_versions WHERE source_database_key = $2) AS versions,
          (SELECT count(*)::int FROM act_replacement_observations WHERE source_database_key = $2) AS observations`,
        [seeded.runId, databaseKey],
      );
      expect(durable.rows[0]).toEqual({
        decisions: 4,
        requests: 1,
        pending: 0,
        ...before.rows[0]!,
      });
      await runtime.close();
    },
  );

  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "replaces a proof-stale automatic field decision with fresh manual proof and keeps its audit history",
    async () => {
      const setupPool = await disposableSchemaPool();
      const local = await setupPool.query<{ id: string }>(
        `INSERT INTO contacts (first_name, last_name, email, job_title)
         VALUES ('Proof', 'Replacement', 'proof-replacement@example.com', 'Local Original')
         RETURNING id`,
      );
      const seeded = await seedAutomaticReviewRun(setupPool, [{
        key: "proof-replacement", streamType: "contact", actRecordId: "proof-replacement-act",
        raw: {
          FirstName: "Proof", LastName: "Replacement",
          EmailAddress: "proof-replacement@example.com", JobTitle: "ACT Selected",
        },
      }]);
      const source = seeded.ids.get("proof-replacement")!;
      await setupPool.query(
        `INSERT INTO act_external_links
           (entity_type, source_entity_type, entity_id, act_record_id,
            source_database_key, source_record_id, is_primary, sync_mode)
         VALUES ('contact', 'contact', $1, 'proof-replacement-act', $2, $3, false, 'pull_only')`,
        [local.rows[0]!.id, databaseKey, source.sourceRecordId],
      );

      const runtime = await startTestRuntime();
      const organized = await runtime.organizer.organize(seeded.runId);
      expect(organized.manifest.outcomes.find((outcome) => outcome.sourceRecordId === source.sourceRecordId))
        .toMatchObject({ state: "awaiting_review", issues: [expect.objectContaining({ code: "field_conflict", reason: "jobTitle" })] });
      const originalRebuild = runtime.commandStore.rebuildAfterReviewChange.bind(runtime.commandStore);
      let edited = false;
      const rebuild = vi.spyOn(runtime.commandStore, "rebuildAfterReviewChange").mockImplementation(async (runId) => {
        if (!edited) {
          edited = true;
          await runtime.pool.query(`UPDATE contacts SET job_title = 'Concurrent Local Edit' WHERE id = $1`, [local.rows[0]!.id]);
        }
        return originalRebuild(runId);
      });

      const automatic = completedAutomaticReview(await runtime.approval.resolveAutomatically({
        runId: seeded.runId,
        expectedManifestDigest: organized.manifest.digest,
        requestKey: "proof-stale-automatic",
        requestedBy: "owner",
      }));
      expect(automatic.decisions).toEqual([
        expect.objectContaining({
          sourceRecordId: source.sourceRecordId,
          scope: "field_conflict",
          decision: "use_source",
          fieldName: "jobTitle",
          reviewedLocalValue: "Local Original",
        }),
      ]);
      expect(automatic.reviewedOperationIds).toEqual([]);
      const stalePage = await runtime.reader.readReviewPage({
        runId: seeded.runId,
        state: "needs_review",
        page: 1,
        pageSize: 25,
      });
      const staleRow = stalePage.rows.find((row) => row.sourceRecordId === source.sourceRecordId)!;
      expect(staleRow).toMatchObject({
        conflicts: [{
          fieldName: "jobTitle",
          localValue: "Concurrent Local Edit",
          sourceValue: "ACT Selected",
          reviewToken: expect.objectContaining({ targetEntityId: local.rows[0]!.id }),
        }],
      });

      const replacement = await runtime.approval.decide({
        runId: seeded.runId,
        sourceRecordId: source.sourceRecordId,
        sourceVersionId: source.sourceVersionId,
        scope: "field_conflict",
        decision: "use_source",
        fieldName: "jobTitle",
        requestKey: "proof-stale-manual-replacement",
        decidedBy: "owner",
        reviewToken: staleRow.conflicts[0]!.reviewToken!,
      });
      expect(replacement).toMatchObject({
        decision: "use_source",
        reviewedLocalValue: "Concurrent Local Edit",
        active: true,
      });
      expect(rebuild).toHaveBeenCalledTimes(2);

      const history = await runtime.pool.query<{
        id: string; decision: string; active: boolean; reviewed_local_value: string;
        superseded_at: Date | null; superseded_by: string | null;
      }>(`SELECT id::text, decision, active, reviewed_local_value, superseded_at, superseded_by
          FROM act_replacement_review_decisions
          WHERE source_record_id = $1 AND scope = 'field_conflict' AND field_name = 'jobTitle'
          ORDER BY created_at, id`, [source.sourceRecordId]);
      expect(history.rows).toEqual([
        expect.objectContaining({
          id: automatic.decisions[0]!.id,
          active: false,
          reviewed_local_value: "Local Original",
          superseded_at: expect.any(Date),
          superseded_by: "owner",
        }),
        expect.objectContaining({
          id: replacement.id,
          active: true,
          reviewed_local_value: "Concurrent Local Edit",
          superseded_at: null,
          superseded_by: null,
        }),
      ]);
      expect(history.rows.filter((decision) => decision.active)).toHaveLength(1);
      const rebuiltPage = await runtime.reader.readReviewPage({
        runId: seeded.runId,
        state: "needs_review",
        page: 1,
        pageSize: 25,
      });
      expect(rebuiltPage.rows.some((row) => row.sourceRecordId === source.sourceRecordId)).toBe(false);
      await runtime.close();
    },
  );

  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "recovers a complete-with-issues cleanup and imports its rebuilt safe closure exactly once",
    async () => {
      const setupPool = await disposableSchemaPool();
      const natalie = await setupPool.query<{ id: string }>(
        `INSERT INTO contacts (first_name, last_name, email, job_title)
         VALUES ('Natalie', 'Andelin', 'natalie-boundary@example.com', 'Local Director')
         RETURNING id`,
      );
      await setupPool.query(
        `INSERT INTO contacts (first_name, last_name, phone) VALUES
          ('Existing', 'Boundary Alpha', '555-700-8000'),
          ('Existing', 'Boundary Beta', '555-700-8000')`,
      );
      await setupPool.query(
        `INSERT INTO contacts (first_name, last_name, email) VALUES
          ('Dana', 'Duplicate Boundary', 'dana-one@example.com'),
          ('Dana', 'Duplicate Boundary', 'dana-two@example.com'),
          ('Casey', 'Conflict Boundary', 'local-casey@example.com')`,
      );
      const seeded = await seedAutomaticReviewRun(setupPool, [
        {
          key: "boundary-natalie", streamType: "contact", actRecordId: "boundary-natalie-act",
          raw: { FirstName: "Natalie", LastName: "Andelin", EmailAddress: "natalie-boundary@example.com", JobTitle: "ACT Director" },
        },
        {
          key: "boundary-new", streamType: "contact", actRecordId: "boundary-new-act",
          raw: { FirstName: "Maya", LastName: "Boundary", BusinessPhone: "555-700-8000" },
        },
        {
          key: "boundary-optional", streamType: "contact", actRecordId: "boundary-optional-act",
          raw: { FirstName: "Optional", LastName: "Boundary" },
        },
        {
          key: "boundary-optional-relationship", streamType: "company_contact",
          raw: {},
          relationshipEvidence: {
            source: "endpoint", parentKind: "contact", parentActRecordId: "boundary-optional-act",
            targetKind: "company", targetActRecordId: "missing-boundary-company",
          },
        },
        {
          key: "boundary-unsupported", streamType: "contact", actRecordId: "boundary-unsupported-act",
          raw: { FirstName: "Unsupported only", EmailAddress: "raw-private@example.com", BusinessPhone: "555-000-1111" },
        },
        {
          key: "boundary-duplicate", streamType: "contact", actRecordId: "boundary-duplicate-act",
          raw: { FirstName: "Dana", LastName: "Duplicate Boundary" },
        },
        {
          key: "boundary-conflict", streamType: "contact", actRecordId: "boundary-conflict-act",
          raw: { FirstName: "Casey", LastName: "Conflict Boundary", EmailAddress: "act-casey@example.com" },
        },
        {
          key: "boundary-required", streamType: "company", actRecordId: "boundary-required-act",
          raw: { Name: "Required Boundary Company" },
        },
        {
          key: "boundary-required-relationship", streamType: "company_contact",
          raw: {},
          relationshipEvidence: {
            source: "endpoint", parentKind: "company", parentActRecordId: "boundary-required-act",
            targetKind: "contact", targetActRecordId: "missing-required-contact",
          },
        },
      ]);
      const importedActIds = [
        "boundary-natalie-act",
        "boundary-new-act",
        "boundary-optional-act",
        "boundary-unsupported-act",
        "boundary-duplicate-act",
        "boundary-conflict-act",
        "boundary-required-act",
      ];
      const runtime = await startTestRuntime();
      const organized = await runtime.organizer.organize(seeded.runId);
      await runtime.pool.query(
        `UPDATE act_replacement_runs SET phase = 'complete_with_issues', completed_at = now()
         WHERE id = $1`,
        [seeded.runId],
      );
      const archiveBefore = await archivedRunSnapshot(runtime.pool, seeded.runId);
      const targetsBefore = await targetTableSnapshot(runtime.pool);
      const natalieBefore = await contactSnapshot(runtime.pool, natalie.rows[0]!.id);
      expect(natalieBefore).toEqual({
        id: natalie.rows[0]!.id,
        first_name: "Natalie",
        last_name: "Andelin",
        email: "natalie-boundary@example.com",
        phone: null,
        job_title: "Local Director",
        act_record_id: null,
      });
      expect(await importedProfileCounts(runtime.pool, importedActIds)).toEqual({
        organizations: 0,
        contacts: 0,
        source_links: 0,
      });

      const originalRebuild = runtime.commandStore.rebuildAfterReviewChange.bind(runtime.commandStore);
      const interruption = Object.assign(new Error("interrupted_after_decision_commit"), {
        code: "interrupted_after_decision_commit",
      });
      const rebuild = vi.spyOn(runtime.commandStore, "rebuildAfterReviewChange")
        .mockRejectedValueOnce(interruption)
        .mockImplementation(originalRebuild);
      const automaticRequest = {
        runId: seeded.runId,
        expectedManifestDigest: organized.manifest.digest,
        requestKey: "boundary-automatic-cleanup",
        requestedBy: "owner",
      };

      await expect(runtime.approval.resolveAutomatically(automaticRequest)).rejects.toBe(interruption);
      const committed = await runtime.pool.query<{ decisions: number; pending: number }>(`SELECT
          (SELECT count(*)::int FROM act_replacement_review_decisions decision
          JOIN act_replacement_outcomes outcome ON outcome.source_record_id = decision.source_record_id
          WHERE outcome.run_id = $1) AS decisions,
        (SELECT count(*)::int FROM act_replacement_bulk_review_requests
          WHERE run_id = $1 AND request_key = 'boundary-automatic-cleanup'
            AND manifest_digest = '__pending_review_rebuild__') AS pending`,
      [seeded.runId]);
      expect(committed.rows[0]).toMatchObject({ decisions: 5, pending: 1 });
      const interruptedIds = await automaticDurableIds(
        runtime.pool,
        seeded.runId,
        automaticRequest.requestKey,
      );
      expect(interruptedIds).toMatchObject({
        distinctDecisionIds: 5,
        requestIds: [expect.any(String)],
        distinctRequestIds: 1,
      });
      expect(interruptedIds.decisionIds).toHaveLength(5);
      expect(await targetTableSnapshot(runtime.pool)).toEqual(targetsBefore);
      expect(await contactSnapshot(runtime.pool, natalie.rows[0]!.id)).toEqual(natalieBefore);
      expect(await importedProfileCounts(runtime.pool, importedActIds)).toEqual({
        organizations: 0,
        contacts: 0,
        source_links: 0,
      });

      const resolved = completedAutomaticReview(await runtime.approval.resolveAutomatically(automaticRequest));
      expect(rebuild).toHaveBeenCalledTimes(2);
      expect(resolved.decisions).toHaveLength(5);
      expect(resolved.decisions).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceRecordId: seeded.ids.get("boundary-natalie")!.sourceRecordId, scope: "duplicate_identity", decision: "link_existing", targetEntityId: natalie.rows[0]!.id }),
        expect.objectContaining({ sourceRecordId: seeded.ids.get("boundary-natalie")!.sourceRecordId, scope: "field_conflict", decision: "use_source", fieldName: "jobTitle" }),
        expect.objectContaining({ sourceRecordId: seeded.ids.get("boundary-new")!.sourceRecordId, scope: "duplicate_identity", decision: "keep_separate" }),
        expect.objectContaining({ sourceRecordId: seeded.ids.get("boundary-optional")!.sourceRecordId, scope: "relationship", decision: "keep_unlinked" }),
        expect.objectContaining({ sourceRecordId: seeded.ids.get("boundary-unsupported")!.sourceRecordId, scope: "unsupported_record", decision: "ignore_source" }),
      ]));
      expect(resolved.decisions.map((decision) => decision.id).sort()).toEqual(interruptedIds.decisionIds);
      expect(await automaticDurableIds(runtime.pool, seeded.runId, automaticRequest.requestKey)).toEqual(interruptedIds);
      expect(await targetTableSnapshot(runtime.pool)).toEqual(targetsBefore);
      expect(await contactSnapshot(runtime.pool, natalie.rows[0]!.id)).toEqual(natalieBefore);

      const replayedResolution = completedAutomaticReview(await runtime.approval.resolveAutomatically(automaticRequest));
      expect(replayedResolution).toEqual(resolved);
      expect(await automaticDurableIds(runtime.pool, seeded.runId, automaticRequest.requestKey)).toEqual(interruptedIds);
      expect(await targetTableSnapshot(runtime.pool)).toEqual(targetsBefore);
      expect(await contactSnapshot(runtime.pool, natalie.rows[0]!.id)).toEqual(natalieBefore);

      const remaining = await runtime.reader.readReviewPage({
        runId: seeded.runId,
        state: "needs_review",
        page: 1,
        pageSize: 25,
      });
      expect(remaining.rows.map((row) => ({
        sourceRecordId: row.sourceRecordId,
        issueCodes: row.issues.map((issue) => issue.code).sort(),
      })).sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId))).toEqual([
        {
          sourceRecordId: seeded.ids.get("boundary-conflict")!.sourceRecordId,
          issueCodes: ["ambiguous_match"],
        },
        {
          sourceRecordId: seeded.ids.get("boundary-duplicate")!.sourceRecordId,
          issueCodes: ["ambiguous_match"],
        },
        {
          sourceRecordId: seeded.ids.get("boundary-required")!.sourceRecordId,
          issueCodes: ["relationship_unresolved"],
        },
      ].sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId)));

      const unsupportedSourceId = seeded.ids.get("boundary-unsupported")!.sourceRecordId;
      const unsupportedBoundary = await runtime.pool.query<{ operations: number; raw_snapshot: Record<string, unknown> }>(`
        SELECT
          (SELECT count(*)::int FROM act_replacement_apply_operations
            WHERE run_id = $1 AND source_record_id = $2) AS operations,
          version.raw_snapshot
        FROM act_source_records source
        JOIN act_source_record_versions version ON version.id = source.latest_version_id
        WHERE source.id = $2`,
      [seeded.runId, unsupportedSourceId]);
      expect(unsupportedBoundary.rows[0]).toEqual({
        operations: 0,
        raw_snapshot: {
          FirstName: "Unsupported only",
          EmailAddress: "raw-private@example.com",
          BusinessPhone: "555-000-1111",
        },
      });

      const approval = await runtime.approval.approveSafeDefaults({
        runId: seeded.runId,
        expectedManifestDigest: resolved.manifestDigest,
        requestKey: "boundary-safe-approval",
        requestedBy: "owner",
      });
      expect(approval.approvedOperationIds.length).toBeGreaterThan(0);
      expect(approval.rejectedOperationIds).toEqual(expect.arrayContaining(resolved.reviewedOperationIds));
      const combinedApproval = await runtime.approval.approve({
        runId: seeded.runId,
        operationIds: [
          ...approval.approvedOperationIds,
          ...resolved.reviewedOperationIds,
        ],
        expectedManifestDigest: resolved.manifestDigest,
        requestKey: "boundary-combined-approval",
        requestedBy: "owner",
      });
      expect(new Set(combinedApproval.approvedOperationIds)).toEqual(new Set([
        ...approval.approvedOperationIds,
        ...resolved.reviewedOperationIds,
      ]));
      expect(await targetTableSnapshot(runtime.pool)).toEqual(targetsBefore);
      expect(await contactSnapshot(runtime.pool, natalie.rows[0]!.id)).toEqual(natalieBefore);
      expect(await importedProfileCounts(runtime.pool, importedActIds)).toEqual({
        organizations: 0,
        contacts: 0,
        source_links: 0,
      });
      expect(await archivedRunSnapshot(runtime.pool, seeded.runId)).toEqual(archiveBefore);

      await applyAllInBatches(runtime.coordinator, {
        runId: seeded.runId,
        manifestDigest: resolved.manifestDigest,
        approvalRequestKey: "boundary-combined-approval",
      });
      expect(await contactSnapshot(runtime.pool, natalie.rows[0]!.id)).toEqual({
        ...natalieBefore,
        job_title: "ACT Director",
      });
      const importedOnce = await importedProfileCounts(runtime.pool, importedActIds);
      expect(importedOnce).toEqual({ organizations: 0, contacts: 2, source_links: 1 });
      const importedRowsOnce = await importedProfileSnapshot(runtime.pool, importedActIds);
      await applyAllInBatches(runtime.coordinator, {
        runId: seeded.runId,
        manifestDigest: resolved.manifestDigest,
        approvalRequestKey: "boundary-combined-approval",
      });
      expect(await importedProfileCounts(runtime.pool, importedActIds)).toEqual(importedOnce);
      expect(await importedProfileSnapshot(runtime.pool, importedActIds)).toEqual(importedRowsOnce);
      expect(await contactSnapshot(runtime.pool, natalie.rows[0]!.id)).toEqual({
        ...natalieBefore,
        job_title: "ACT Director",
      });
      expect(await archivedRunSnapshot(runtime.pool, seeded.runId)).toEqual(archiveBefore);

      const durable = await runtime.pool.query<{ decisions: number; requests: number }>(`SELECT
        (SELECT count(*)::int FROM act_replacement_review_decisions decision
          JOIN act_replacement_outcomes outcome ON outcome.source_record_id = decision.source_record_id
          WHERE outcome.run_id = $1) AS decisions,
        (SELECT count(*)::int FROM act_replacement_bulk_review_requests
          WHERE run_id = $1 AND request_key = 'boundary-automatic-cleanup') AS requests`,
      [seeded.runId]);
      expect(durable.rows[0]).toEqual({ decisions: 5, requests: 1 });
      expect(await automaticDurableIds(runtime.pool, seeded.runId, automaticRequest.requestKey)).toEqual(interruptedIds);
      await runtime.close();
    },
  );

  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "leaves duplicate, required-parent, stale-version, and changed-conflict cases reviewable without unsafe decisions",
    async () => {
      const setupPool = await disposableSchemaPool();

      await setupPool.query(
        `INSERT INTO contacts (first_name, last_name, email)
         SELECT 'A', noise.last_name, 'noise-' || noise.ordinality::text || '@example.com'
         FROM unnest($1::text[]) WITH ORDINALITY AS noise(last_name, ordinality)`,
        [duplicateANoiseLastNames],
      );
      await setupPool.query(
        `INSERT INTO contacts (first_name, last_name, email)
         VALUES ('Natalie', 'Duplicate', 'duplicate-natalie@example.com'),
                ('Natalie', 'Duplicate', 'duplicate-natalie@example.com')`,
      );
      await setupPool.query(
        `INSERT INTO contacts (first_name, last_name, email)
         SELECT 'Z', noise.last_name, 'z-noise-' || noise.ordinality::text || '@example.com'
         FROM unnest($1::text[]) WITH ORDINALITY AS noise(last_name, ordinality)`,
        [duplicateZNoiseLastNames],
      );
      const legacyWindow = await setupPool.query<{ ordinal: number; label: string }>(
        `SELECT row_number() OVER (ORDER BY lower(regexp_replace(trim(label), '\\s+', ' ', 'g')) COLLATE "C", id) AS ordinal, label
         FROM (
           SELECT id, concat_ws(' ', first_name, last_name) AS label
           FROM contacts
         ) targets
         WHERE lower(regexp_replace(trim(label), '\\s+', ' ', 'g')) LIKE '%natalie duplicate%'`,
      );
      expect(legacyWindow.rows).toHaveLength(32);
      expect(legacyWindow.rows.filter((row) => row.label === "Natalie Duplicate").map((row) => Number(row.ordinal))).toEqual([25, 26]);
      const duplicate = await seedAutomaticReviewRun(setupPool, [{
        key: "duplicate-natalie", streamType: "contact", actRecordId: "duplicate-natalie-act",
        raw: { FirstName: "Natalie", LastName: "Duplicate", EmailAddress: "duplicate-natalie@example.com" },
      }]);
      const duplicateRuntime = await startTestRuntime();
      const duplicateManifest = await duplicateRuntime.organizer.organize(duplicate.runId);
      await expect(duplicateRuntime.approval.resolveAutomatically({
        runId: duplicate.runId, expectedManifestDigest: duplicateManifest.manifest.digest,
        requestKey: "duplicate-negative", requestedBy: "owner",
      })).resolves.toMatchObject({ decisions: [] });
      await duplicateRuntime.close();

      const required = await seedAutomaticReviewRun(setupPool, [{
        key: "required-parent", streamType: "contact", actRecordId: "required-parent-act",
        raw: { FirstName: "Required", LastName: "Parent" },
      }]);
      const requiredRuntime = await startTestRuntime();
      const requiredManifest = await requiredRuntime.organizer.organize(required.runId);
      await requiredRuntime.pool.query(
        `UPDATE act_replacement_outcomes
         SET state = 'awaiting_review', issues = $2::jsonb
         WHERE run_id = $1 AND source_record_id = $3`,
        [
          required.runId,
          JSON.stringify([{
            code: "relationship_unresolved", reason: "required_parent_missing",
            relationshipSlot: "required-parent", expectedParentTypes: ["organization"], canImportStandalone: false,
          }]),
          required.ids.get("required-parent")!.sourceRecordId,
        ],
      );
      await expect(requiredRuntime.approval.resolveAutomatically({
        runId: required.runId, expectedManifestDigest: requiredManifest.manifest.digest,
        requestKey: "required-negative", requestedBy: "owner",
      })).rejects.toMatchObject({ code: "manifest_digest_mismatch", status: 409 });
      await requiredRuntime.close();

      const stale = await seedAutomaticReviewRun(setupPool, [{
        key: "stale-source", streamType: "contact", actRecordId: "stale-source-act",
        raw: { FirstName: "Unsupported" },
      }]);
      const staleRuntime = await startTestRuntime();
      const staleManifest = await staleRuntime.organizer.organize(stale.runId);
      const staleSource = stale.ids.get("stale-source")!;
      const replacementFingerprint = `stale-replacement-${randomUUID()}`;
      const replacementVersion = await staleRuntime.pool.query<{ id: string }>(
        `INSERT INTO act_source_record_versions
           (source_record_id, source_database_key, fingerprint, raw_snapshot, snapshot_scope, observed_run_id)
         VALUES ($1, $2, $3, $4::jsonb, 'detail', $5) RETURNING id`,
        [staleSource.sourceRecordId, databaseKey, replacementFingerprint, JSON.stringify({ FirstName: "Now", LastName: "Current" }), stale.runId],
      );
      await staleRuntime.pool.query(
        `UPDATE act_source_records SET latest_version_id = $1, latest_fingerprint = $2 WHERE id = $3`,
        [replacementVersion.rows[0]!.id, replacementFingerprint, staleSource.sourceRecordId],
      );
      await expect(staleRuntime.approval.resolveAutomatically({
        runId: stale.runId, expectedManifestDigest: staleManifest.manifest.digest,
        requestKey: "stale-negative", requestedBy: "owner",
      })).rejects.toMatchObject({ code: "stale_source_version", status: 409 });
      await staleRuntime.close();

      const conflictTarget = await setupPool.query<{ id: string }>(
        `INSERT INTO contacts (first_name, last_name, email, job_title)
         VALUES ('Conflict', 'Person', 'conflict-person@example.com', 'Local Original') RETURNING id`,
      );
      const conflict = await seedAutomaticReviewRun(setupPool, [{
        key: "changed-conflict", streamType: "contact", actRecordId: "changed-conflict-act",
        raw: { FirstName: "Conflict", LastName: "Person", EmailAddress: "conflict-person@example.com", JobTitle: "ACT Selected" },
      }]);
      const conflictRuntime = await startTestRuntime();
      const conflictManifest = await conflictRuntime.organizer.organize(conflict.runId);
      let targetReads = 0;
      const targetSpy = vi.spyOn(
        DrizzleActReviewCommandStore.prototype as unknown as { lockedConflictTarget: (entityType: string, entityId: string) => Promise<unknown> },
        "lockedConflictTarget",
      ).mockImplementation(async () => {
        targetReads += 1;
        return {
          id: conflictTarget.rows[0]!.id,
          entityType: "contact",
          label: "Conflict Person",
          detail: "conflict-person@example.com",
          fields: {
            firstName: "Conflict", lastName: "Person", email: "conflict-person@example.com",
            jobTitle: targetReads >= 3 ? "Locally Changed" : "Local Original",
          },
        };
      });
      try {
        await expect(conflictRuntime.approval.resolveAutomatically({
          runId: conflict.runId, expectedManifestDigest: conflictManifest.manifest.digest,
          requestKey: "conflict-negative", requestedBy: "owner",
        })).rejects.toMatchObject({ code: "stale_review_token", status: 409 });
      } finally {
        targetSpy.mockRestore();
      }

      const unsafeWrites = await conflictRuntime.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM act_replacement_review_decisions d
         JOIN act_replacement_outcomes o ON o.source_record_id = d.source_record_id
         WHERE o.run_id = ANY($1::uuid[])`,
        [[duplicate.runId, required.runId, stale.runId, conflict.runId]],
      );
      expect(unsafeWrites.rows[0]?.count).toBe(0);
      const stillReviewable = await conflictRuntime.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM act_replacement_outcomes
         WHERE run_id = ANY($1::uuid[]) AND state IN ('awaiting_review', 'unsupported')`,
        [[duplicate.runId, required.runId, conflict.runId]],
      );
      expect(stillReviewable.rows[0]?.count).toBe(3);
      await conflictRuntime.close();
    },
  );
});
