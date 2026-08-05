import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@workspace/db/schema";

const replacementTableNames = [
  "actReplacementRuns",
  "actReplacementCheckpoints",
  "actReplacementPageReceipts",
  "actSourceRecords",
  "actSourceRecordVersions",
  "actReplacementObservations",
  "actReplacementRequestAudits",
] as const;

function requiredTable(name: (typeof replacementTableNames)[number]) {
  const table = (schema as Record<string, unknown>)[name];
  expect(
    table,
    `${name} must be exported by @workspace/db/schema`,
  ).toBeDefined();
  return table as AnyPgTable;
}

function columnNames(name: (typeof replacementTableNames)[number]) {
  return Object.values(getTableColumns(requiredTable(name))).map(
    (column) => column.name,
  );
}

describe("Act replacement schema contract", () => {
  it("exports the exact Phase 1 literals", async () => {
    const importTypes = await import("./import-types");

    expect(importTypes.actReplacementStreamTypes).toEqual([
      "company",
      "contact",
      "opportunity",
      "group",
      "company_contact",
      "opportunity_company",
      "opportunity_contact",
      "group_contact",
      "activity",
      "note",
      "history",
      "activity_contact",
      "activity_company",
      "activity_opportunity",
      "note_contact",
      "note_company",
      "note_opportunity",
      "history_contact",
      "history_company",
      "history_opportunity",
    ]);
    expect(importTypes.actReplacementRunPhases).toEqual([
      "extracting",
      "extract_complete",
      "organizing",
      "ready_to_apply",
      "applying",
      "complete",
      "complete_with_issues",
      "failed",
      "superseded",
    ]);
    expect(importTypes.actCheckpointKinds).toEqual([
      "list",
      "plain_list_fallback",
      "detail",
      "relationship",
    ]);
    expect(importTypes.actCheckpointRequirednesses).toEqual([
      "required",
      "optional_capability",
    ]);
    expect(importTypes.actCheckpointStates).toEqual([
      "pending",
      "leased",
      "retry_wait",
      "complete",
      "unsupported",
      "failed",
    ]);
    expect(importTypes.actQueryModes).toEqual(["projected", "plain"]);
    expect(importTypes.actArchiveCompletenessValues).toEqual([
      "discovered",
      "complete",
      "partial",
      "failed",
    ]);
    expect(importTypes.actSnapshotScopes).toEqual([
      "list_projected",
      "list_plain",
      "detail",
      "relationship",
    ]);
    expect(importTypes.actRequestAuditStates).toEqual([
      "started",
      "succeeded",
      "failed",
    ]);
    expect(importTypes.actSafeErrorCodes).toEqual([
      "not_configured",
      "authentication_failed",
      "permission_denied",
      "query_rejected",
      "not_found",
      "endpoint_unsupported",
      "rate_limited",
      "timeout",
      "unavailable",
      "invalid_response",
      "pagination_stalled",
    ]);
  });

  it("exports every durable extraction table", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([...replacementTableNames]),
    );
  });

  it("stores the durable checkpoint cursor, derivation flag, and seven counters", () => {
    expect(columnNames("actReplacementCheckpoints")).toEqual(
      expect.arrayContaining([
        "run_id",
        "source_database_key",
        "stream_type",
        "checkpoint_kind",
        "partition_key",
        "requiredness",
        "parent_source_record_id",
        "parent_act_record_id",
        "source_record_id",
        "next_skip",
        "page_size",
        "query_mode",
        "derive_details",
        "state",
        "lease_owner",
        "lease_expires_at",
        "retry_after",
        "retryable",
        "attempt_count",
        "response_rows",
        "observed_identities",
        "archived_identities",
        "complete_identities",
        "partial_identities",
        "failed_identities",
        "snapshot_versions_inserted",
      ]),
    );
  });

  it("stores the database and stream context needed for relational coherence", () => {
    expect(columnNames("actSourceRecordVersions")).toContain(
      "source_database_key",
    );
    expect(columnNames("actReplacementPageReceipts")).toContain("stream_type");
    expect(columnNames("actReplacementObservations")).toContain(
      "source_database_key",
    );
  });

  it("keeps request audits metadata-only with nullable completion fields", () => {
    const auditColumns = getTableColumns(
      requiredTable("actReplacementRequestAudits"),
    );

    expect(Object.values(auditColumns).map((column) => column.name)).toEqual([
      "id",
      "run_id",
      "checkpoint_id",
      "stream_type",
      "method",
      "path_template",
      "state",
      "http_status",
      "safe_error_code",
      "duration_ms",
      "started_at",
      "completed_at",
    ]);
    expect(auditColumns.httpStatus.notNull).toBe(false);
    expect(auditColumns.safeErrorCode.notNull).toBe(false);
    expect(auditColumns.durationMs.notNull).toBe(false);
    expect(auditColumns.completedAt.notNull).toBe(false);
    expect(Object.keys(auditColumns)).not.toEqual(
      expect.arrayContaining([
        "query",
        "queryParams",
        "headers",
        "requestHeaders",
        "body",
        "requestBody",
      ]),
    );
  });

  it("declares database-enforced uniqueness and immutability contracts", () => {
    const runIndexes = getTableConfig(
      requiredTable("actReplacementRuns"),
    ).indexes.map((index) => index.config.name);
    const sourceIndexes = getTableConfig(
      requiredTable("actSourceRecords"),
    ).indexes.map((index) => index.config.name);
    const versionIndexes = getTableConfig(
      requiredTable("actSourceRecordVersions"),
    ).indexes.map((index) => index.config.name);

    expect(runIndexes).toEqual(
      expect.arrayContaining([
        "act_replacement_runs_database_request_unique",
        "act_replacement_runs_one_active_per_database",
      ]),
    );
    expect(sourceIndexes).toEqual(
      expect.arrayContaining([
        "act_source_records_database_stream_source_key_unique",
        "act_source_records_database_stream_act_id_unique",
      ]),
    );
    expect(versionIndexes).toContain(
      "act_source_record_versions_record_fingerprint_unique",
    );
  });

  it("declares composite foreign keys for database, stream, and version ownership", () => {
    const foreignKeyNames = (name: (typeof replacementTableNames)[number]) =>
      getTableConfig(requiredTable(name)).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      );

    expect(foreignKeyNames("actSourceRecords")).toEqual(
      expect.arrayContaining([
        "act_source_records_first_seen_run_database_fk",
        "act_source_records_last_seen_run_database_fk",
        "act_source_records_latest_version_owner_fk",
      ]),
    );
    expect(foreignKeyNames("actSourceRecordVersions")).toEqual(
      expect.arrayContaining([
        "act_source_record_versions_source_database_fk",
        "act_source_record_versions_observed_run_database_fk",
      ]),
    );
    expect(foreignKeyNames("actReplacementCheckpoints")).toEqual(
      expect.arrayContaining([
        "act_replacement_checkpoints_run_database_fk",
        "act_replacement_checkpoints_parent_source_database_fk",
        "act_replacement_checkpoints_source_database_stream_fk",
      ]),
    );
    expect(foreignKeyNames("actReplacementPageReceipts")).toContain(
      "act_replacement_page_receipts_checkpoint_context_fk",
    );
    expect(foreignKeyNames("actReplacementObservations")).toEqual(
      expect.arrayContaining([
        "act_replacement_observations_run_database_fk",
        "act_replacement_observations_source_database_fk",
        "act_replacement_observations_version_source_fk",
      ]),
    );
    expect(foreignKeyNames("actReplacementRequestAudits")).toContain(
      "act_replacement_request_audits_checkpoint_context_fk",
    );
  });

  it("declares normalized audit metadata checks and latest-version pairing", () => {
    const checkNames = (name: (typeof replacementTableNames)[number]) =>
      getTableConfig(requiredTable(name)).checks.map((check) => check.name);

    expect(checkNames("actSourceRecords")).toContain(
      "act_source_records_latest_version_pair_valid",
    );
    expect(checkNames("actReplacementRequestAudits")).toEqual(
      expect.arrayContaining([
        "act_replacement_request_audits_path_template_safe",
        "act_replacement_request_audits_safe_error_code_valid",
      ]),
    );
  });
});

const describeWithPostgres = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithPostgres("Act replacement migration on PostgreSQL", () => {
  type QueryResult<Row> = { rows: Row[] };
  type TestClient = {
    query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    release(): void;
  };
  type TestPool = {
    connect(): Promise<TestClient>;
    query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  };
  const schemaName = `act_replacement_contract_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schemaName}"`;
  let pool: TestPool;

  async function connectInTestSchema() {
    const client = await pool.connect();
    await client.query(`SET search_path TO ${quotedSchema}, public`);
    return client;
  }

  beforeAll(async () => {
    const pgModuleUrl = new URL(
      "../../../../../lib/db/node_modules/pg/lib/index.js",
      import.meta.url,
    );
    const pgModule = (await import(pgModuleUrl.href)) as {
      default: { Pool: new (config: { connectionString: string }) => TestPool };
    };
    const { Pool } = pgModule.default;
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET search_path TO ${quotedSchema}, public`);
      await client.query(`
        CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL);
        CREATE TABLE act_migration_runs (id uuid PRIMARY KEY, status text NOT NULL);
        INSERT INTO organizations (id, name)
        VALUES ('00000000-0000-0000-0000-000000000001', 'legacy sentinel');
      `);
      const migrationPath = fileURLToPath(
        new URL(
          "../../../../../lib/db/migrations/006_act_replacement_archive.sql",
          import.meta.url,
        ),
      );
      await client.query(await readFile(migrationPath, "utf8"));
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await pool.end();
  });

  it("preserves legacy tables while applying the replacement archive", async () => {
    const client = await connectInTestSchema();
    try {
      const result = await client.query<{ name: string }>(
        "SELECT name FROM organizations",
      );
      expect(result.rows).toEqual([{ name: "legacy sentinel" }]);
      await expect(
        client.query("SELECT count(*) FROM act_migration_runs"),
      ).resolves.toBeDefined();
    } finally {
      client.release();
    }
  });

  it("allows only one active run per source database across sessions", async () => {
    const first = await connectInTestSchema();
    const second = await connectInTestSchema();
    try {
      const results = await Promise.allSettled([
        first.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size)
           VALUES ('request-a', 'database-concurrency', 'owner', 100)`,
        ),
        second.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size)
           VALUES ('request-b', 'database-concurrency', 'owner', 100)`,
        ),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      const count = await first.query<{ count: string }>(
        "SELECT count(*) FROM act_replacement_runs WHERE source_database_key = 'database-concurrency'",
      );
      expect(count.rows[0]?.count).toBe("1");
    } finally {
      first.release();
      second.release();
    }
  });

  it("allows terminal history and scopes request replay by source database", async () => {
    const client = await connectInTestSchema();
    try {
      await expect(
        client.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size, phase)
           VALUES ('shared-request', 'database-partial-index', 'owner', 100,
                   'complete')`,
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size)
           VALUES ('active-request', 'database-partial-index', 'owner', 100)`,
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size, phase)
           VALUES ('older-terminal', 'database-partial-index', 'owner', 100,
                   'failed')`,
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size)
           VALUES ('shared-request', 'database-other-request-scope', 'owner', 100)`,
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size, phase)
           VALUES ('invalid-phase', 'database-invalid-phase', 'owner', 100,
                   'queued')`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      client.release();
    }
  });

  it("rejects cross-database and cross-stream archive relationships", async () => {
    const client = await connectInTestSchema();
    try {
      const runA = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_runs
           (request_key, source_database_key, requested_by, page_size)
         VALUES ('coherence-a', 'database-coherence-a', 'owner', 100)
         RETURNING id`,
      );
      const runB = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_runs
           (request_key, source_database_key, requested_by, page_size)
         VALUES ('coherence-b', 'database-coherence-b', 'owner', 100)
         RETURNING id`,
      );

      await expect(
        client.query(
          `INSERT INTO act_source_records
             (source_database_key, stream_type, source_key,
              first_seen_run_id, last_seen_run_id)
           VALUES ('database-coherence-a', 'contact', 'mixed-runs', $1, $2)`,
          [runA.rows[0]?.id, runB.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      const sourceA = await client.query<{ id: string }>(
        `INSERT INTO act_source_records
           (source_database_key, stream_type, source_key,
            first_seen_run_id, last_seen_run_id)
         VALUES ('database-coherence-a', 'contact', 'contact-a', $1, $1)
         RETURNING id`,
        [runA.rows[0]?.id],
      );
      const sourceB = await client.query<{ id: string }>(
        `INSERT INTO act_source_records
           (source_database_key, stream_type, source_key,
            first_seen_run_id, last_seen_run_id)
         VALUES ('database-coherence-b', 'contact', 'contact-b', $1, $1)
         RETURNING id`,
        [runB.rows[0]?.id],
      );

      await expect(
        client.query(
          `INSERT INTO act_replacement_checkpoints
             (run_id, source_database_key, stream_type, checkpoint_kind,
              partition_key, requiredness, source_record_id, page_size)
           VALUES ($1, 'database-coherence-a', 'contact', 'detail',
                   'wrong-run', 'required', $2, 100)`,
          [runB.rows[0]?.id, sourceA.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_checkpoints
             (run_id, source_database_key, stream_type, checkpoint_kind,
              partition_key, requiredness, source_record_id, page_size)
           VALUES ($1, 'database-coherence-a', 'company', 'detail',
                   'wrong-stream', 'required', $2, 100)`,
          [runA.rows[0]?.id, sourceA.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_checkpoints
             (run_id, source_database_key, stream_type, checkpoint_kind,
              partition_key, requiredness, source_record_id, page_size)
           VALUES ($1, 'database-coherence-a', 'contact', 'detail',
                   'wrong-database', 'required', $2, 100)`,
          [runA.rows[0]?.id, sourceB.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_checkpoints
             (run_id, source_database_key, stream_type, checkpoint_kind,
              partition_key, requiredness, parent_source_record_id, page_size)
           VALUES ($1, 'database-coherence-a', 'company_contact',
                   'relationship', 'wrong-parent-database',
                   'optional_capability', $2, 100)`,
          [runA.rows[0]?.id, sourceB.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      const checkpointA = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_checkpoints
           (run_id, source_database_key, stream_type, checkpoint_kind,
            partition_key, requiredness, source_record_id, page_size)
         VALUES ($1, 'database-coherence-a', 'contact', 'detail',
                 'valid-contact', 'required', $2, 100)
         RETURNING id`,
        [runA.rows[0]?.id, sourceA.rows[0]?.id],
      );

      await expect(
        client.query(
          `INSERT INTO act_replacement_page_receipts
             (run_id, checkpoint_id, stream_type, page_skip, query_mode,
              page_fingerprint, response_rows)
           VALUES ($1, $2, 'contact', 0, 'projected', 'wrong-run', 1)`,
          [runB.rows[0]?.id, checkpointA.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_page_receipts
             (run_id, checkpoint_id, stream_type, page_skip, query_mode,
              page_fingerprint, response_rows)
           VALUES ($1, $2, 'company', 0, 'projected', 'wrong-stream', 1)`,
          [runA.rows[0]?.id, checkpointA.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_request_audits
             (run_id, checkpoint_id, stream_type, method, path_template, state)
           VALUES ($1, $2, 'contact', 'GET', '/api/contacts', 'started')`,
          [runB.rows[0]?.id, checkpointA.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_request_audits
             (run_id, checkpoint_id, stream_type, method, path_template, state)
           VALUES ($1, $2, 'company', 'GET', '/api/companies', 'started')`,
          [runA.rows[0]?.id, checkpointA.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      const versionA = await client.query<{ id: string }>(
        `INSERT INTO act_source_record_versions
           (source_record_id, source_database_key, fingerprint, raw_snapshot,
            snapshot_scope, observed_run_id)
         VALUES ($1, 'database-coherence-a', 'fingerprint-a', '{}'::jsonb,
                 'detail', $2)
         RETURNING id`,
        [sourceA.rows[0]?.id, runA.rows[0]?.id],
      );
      await expect(
        client.query(
          `INSERT INTO act_source_record_versions
             (source_record_id, source_database_key, fingerprint, raw_snapshot,
              snapshot_scope, observed_run_id)
           VALUES ($1, 'database-coherence-a', 'wrong-version-run', '{}'::jsonb,
                   'detail', $2)`,
          [sourceA.rows[0]?.id, runB.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_observations
             (run_id, source_database_key, source_record_id, version_id,
              snapshot_scope)
           VALUES ($1, 'database-coherence-a', $2, $3, 'detail')`,
          [runB.rows[0]?.id, sourceA.rows[0]?.id, versionA.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      client.release();
    }
  });

  it("binds latest and observed versions to their source identity and fingerprint", async () => {
    const client = await connectInTestSchema();
    try {
      const run = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_runs
           (request_key, source_database_key, requested_by, page_size)
         VALUES ('version-owner', 'database-version-owner', 'owner', 100)
         RETURNING id`,
      );
      const first = await client.query<{ id: string }>(
        `INSERT INTO act_source_records
           (source_database_key, stream_type, source_key,
            first_seen_run_id, last_seen_run_id)
         VALUES ('database-version-owner', 'contact', 'first', $1, $1)
         RETURNING id`,
        [run.rows[0]?.id],
      );
      const second = await client.query<{ id: string }>(
        `INSERT INTO act_source_records
           (source_database_key, stream_type, source_key,
            first_seen_run_id, last_seen_run_id)
         VALUES ('database-version-owner', 'contact', 'second', $1, $1)
         RETURNING id`,
        [run.rows[0]?.id],
      );
      const firstVersion = await client.query<{ id: string }>(
        `INSERT INTO act_source_record_versions
           (source_record_id, source_database_key, fingerprint, raw_snapshot,
            snapshot_scope, observed_run_id)
         VALUES ($1, 'database-version-owner', 'first-fingerprint', '{}'::jsonb,
                 'detail', $2)
         RETURNING id`,
        [first.rows[0]?.id, run.rows[0]?.id],
      );
      const secondVersion = await client.query<{ id: string }>(
        `INSERT INTO act_source_record_versions
           (source_record_id, source_database_key, fingerprint, raw_snapshot,
            snapshot_scope, observed_run_id)
         VALUES ($1, 'database-version-owner', 'second-fingerprint', '{}'::jsonb,
                 'detail', $2)
         RETURNING id`,
        [second.rows[0]?.id, run.rows[0]?.id],
      );

      await expect(
        client.query(
          `UPDATE act_source_records
           SET latest_version_id = $2, latest_fingerprint = 'second-fingerprint'
           WHERE id = $1`,
          [first.rows[0]?.id, secondVersion.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `UPDATE act_source_records
           SET latest_version_id = $2, latest_fingerprint = 'wrong-fingerprint'
           WHERE id = $1`,
          [first.rows[0]?.id, firstVersion.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          "UPDATE act_source_records SET latest_version_id = $2 WHERE id = $1",
          [first.rows[0]?.id, firstVersion.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `UPDATE act_source_records
           SET latest_version_id = $2, latest_fingerprint = 'first-fingerprint'
           WHERE id = $1`,
          [first.rows[0]?.id, firstVersion.rows[0]?.id],
        ),
      ).resolves.toBeDefined();

      await expect(
        client.query(
          `INSERT INTO act_replacement_observations
             (run_id, source_database_key, source_record_id, version_id,
              snapshot_scope)
           VALUES ($1, 'database-version-owner', $2, $3, 'detail')`,
          [run.rows[0]?.id, first.rows[0]?.id, secondVersion.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_observations
             (run_id, source_database_key, source_record_id, version_id,
              snapshot_scope)
           VALUES ($1, 'database-version-owner', $2, $3, 'detail')`,
          [run.rows[0]?.id, first.rows[0]?.id, firstVersion.rows[0]?.id],
        ),
      ).resolves.toBeDefined();
    } finally {
      client.release();
    }
  });

  it("enforces page size, preview default, fixed audit method, and fixed states", async () => {
    const client = await connectInTestSchema();
    try {
      const run = await client.query<{ id: string; preview_only: boolean }>(
        `INSERT INTO act_replacement_runs
           (request_key, source_database_key, requested_by, page_size)
         VALUES ('request-contract', 'database-contract', 'owner', 25)
         RETURNING id, preview_only`,
      );
      expect(run.rows[0]?.preview_only).toBe(true);
      await expect(
        client.query(
          `INSERT INTO act_replacement_runs
             (request_key, source_database_key, requested_by, page_size)
           VALUES ('request-invalid-size', 'database-invalid-size', 'owner', 75)`,
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const checkpoint = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_checkpoints
           (run_id, source_database_key, stream_type, checkpoint_kind,
            partition_key, requiredness, page_size, query_mode, derive_details)
         VALUES ($1, 'database-contract', 'contact', 'list', 'root',
                 'required', 25, 'projected', true)
         RETURNING id`,
        [run.rows[0]?.id],
      );
      await expect(
        client.query(
          `INSERT INTO act_replacement_request_audits
             (run_id, checkpoint_id, stream_type, method, path_template, state)
           VALUES ($1, $2, 'contact', 'POST', '/api/contacts', 'started')`,
          [run.rows[0]?.id, checkpoint.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `INSERT INTO act_replacement_request_audits
             (run_id, checkpoint_id, stream_type, method, path_template, state,
              safe_error_code)
           VALUES ($1, $2, 'contact', 'GET', '/api/contacts', 'failed',
                   'credential_leak')`,
          [run.rows[0]?.id, checkpoint.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      for (const unsafePath of [
        "https://user:secret@example.com/api/contacts",
        "/api/contacts?token=secret",
        "/api/contacts#fragment",
        "/api//contacts",
        "/api/contacts/",
      ]) {
        await expect(
          client.query(
            `INSERT INTO act_replacement_request_audits
               (run_id, checkpoint_id, stream_type, method, path_template, state)
             VALUES ($1, $2, 'contact', 'GET', $3, 'started')`,
            [run.rows[0]?.id, checkpoint.rows[0]?.id, unsafePath],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      }
      await expect(
        client.query(
          `INSERT INTO act_replacement_request_audits
             (run_id, checkpoint_id, stream_type, method, path_template, state,
              safe_error_code)
           VALUES ($1, $2, 'contact', 'GET', '/api/contacts/:contactId',
                   'failed', 'timeout')`,
          [run.rows[0]?.id, checkpoint.rows[0]?.id],
        ),
      ).resolves.toBeDefined();
      await expect(
        client.query(
          `INSERT INTO act_replacement_request_audits
             (run_id, checkpoint_id, stream_type, method, path_template, state)
           VALUES ($1, $2, 'contact', 'GET', '/api/contacts', 'queued')`,
          [run.rows[0]?.id, checkpoint.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      client.release();
    }
  });

  it("rejects invalid fixed literals across archive tables", async () => {
    const client = await connectInTestSchema();
    try {
      const run = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_runs
           (request_key, source_database_key, requested_by, page_size)
         VALUES ('literal-contract', 'database-literal-contract', 'owner', 100)
         RETURNING id`,
      );
      const invalidCheckpointValues = [
        ["unknown_stream", "list", "required", "projected"],
        ["contact", "scan", "required", "projected"],
        ["contact", "list", "best_effort", "projected"],
        ["contact", "list", "required", "ordered"],
      ] as const;
      for (const [
        stream,
        kind,
        requiredness,
        queryMode,
      ] of invalidCheckpointValues) {
        await expect(
          client.query(
            `INSERT INTO act_replacement_checkpoints
               (run_id, source_database_key, stream_type, checkpoint_kind,
                partition_key, requiredness, page_size, query_mode)
             VALUES ($1, 'database-literal-contract', $2, $3, $4, $5, 100, $6)`,
            [
              run.rows[0]?.id,
              stream,
              kind,
              `${stream}:${kind}:${requiredness}:${queryMode}`,
              requiredness,
              queryMode,
            ],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      }

      await expect(
        client.query(
          `INSERT INTO act_source_records
             (source_database_key, stream_type, source_key,
              first_seen_run_id, last_seen_run_id, archive_completeness)
           VALUES ('database-literal-contract', 'contact', 'bad-completeness',
                   $1, $1, 'unknown')`,
          [run.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const source = await client.query<{ id: string }>(
        `INSERT INTO act_source_records
           (source_database_key, stream_type, source_key,
            first_seen_run_id, last_seen_run_id)
         VALUES ('database-literal-contract', 'contact', 'valid-source', $1, $1)
         RETURNING id`,
        [run.rows[0]?.id],
      );
      await expect(
        client.query(
          `INSERT INTO act_source_record_versions
             (source_record_id, source_database_key, fingerprint, raw_snapshot,
              snapshot_scope, observed_run_id)
           VALUES ($1, 'database-literal-contract', 'bad-scope', '{}'::jsonb,
                   'summary', $2)`,
          [source.rows[0]?.id, run.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      client.release();
    }
  });

  it("rejects UPDATE and DELETE of immutable source versions", async () => {
    const client = await connectInTestSchema();
    try {
      const run = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_runs
           (request_key, source_database_key, requested_by, page_size)
         VALUES ('request-immutable', 'database-immutable', 'owner', 200)
         RETURNING id`,
      );
      const source = await client.query<{ id: string }>(
        `INSERT INTO act_source_records
           (source_database_key, stream_type, source_key, act_record_id,
            first_seen_run_id, last_seen_run_id)
         VALUES ('database-immutable', 'contact', 'contact-1', 'contact-1',
                 $1, $1)
         RETURNING id`,
        [run.rows[0]?.id],
      );
      const version = await client.query<{ id: string }>(
        `INSERT INTO act_source_record_versions
           (source_record_id, source_database_key, fingerprint, raw_snapshot,
            snapshot_scope, observed_run_id)
         VALUES ($1, 'database-immutable', 'fingerprint-1',
                 '{"name":"Ada"}'::jsonb, 'detail', $2)
         RETURNING id`,
        [source.rows[0]?.id, run.rows[0]?.id],
      );
      const checkpoint = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_checkpoints
           (run_id, source_database_key, stream_type, checkpoint_kind,
            partition_key, requiredness, page_size)
         VALUES ($1, 'database-immutable', 'contact', 'list', 'root',
                 'required', 200)
         RETURNING id`,
        [run.rows[0]?.id],
      );
      const receipt = await client.query<{ id: string }>(
        `INSERT INTO act_replacement_page_receipts
           (run_id, checkpoint_id, stream_type, page_skip, query_mode,
            page_fingerprint, response_rows)
         VALUES ($1, $2, 'contact', 0, 'projected', 'page-fingerprint', 1)
         RETURNING id`,
        [run.rows[0]?.id, checkpoint.rows[0]?.id],
      );

      await expect(
        client.query(
          "UPDATE act_source_record_versions SET raw_snapshot = '{}'::jsonb WHERE id = $1",
          [version.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        client.query("DELETE FROM act_source_record_versions WHERE id = $1", [
          version.rows[0]?.id,
        ]),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        client.query(
          "UPDATE act_replacement_page_receipts SET response_rows = 2 WHERE id = $1",
          [receipt.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        client.query(
          "DELETE FROM act_replacement_page_receipts WHERE id = $1",
          [receipt.rows[0]?.id],
        ),
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      client.release();
    }
  });
});
