import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, describe, expect, it } from "vitest";

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
import { ReviewCommandService } from "./review-command-service";

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
      region text, postal_code text, website text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
      first_name text NOT NULL, last_name text NOT NULL, email text, phone text,
      job_title text, address_1 text, city text, region text, postal_code text,
      act_record_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
      organization_id uuid REFERENCES organizations(id), city text NOT NULL,
      region text NOT NULL, venue_name text, notes text,
      starts_at timestamptz, ends_at timestamptz,
      act_record_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE calling_lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, kind text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organization_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
      contact_id uuid NOT NULL REFERENCES contacts(id), UNIQUE (organization_id, contact_id)
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
    organizer: new ProductionActOrganizer(
      new DrizzleProductionOrganizerStore(database, scope),
    ),
    approval: new ReviewCommandService(commandStore),
    coordinator: new ActApplyCoordinator(applyService, applyRepository),
    close: () => pool.end(),
  };
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
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))(
    "organizes, applies, restarts, and replays without duplicates",
    async () => {
      const setupPool = await createPool();
      cleanupPool = setupPool;
      await installDisposableSchema(setupPool);
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
});
