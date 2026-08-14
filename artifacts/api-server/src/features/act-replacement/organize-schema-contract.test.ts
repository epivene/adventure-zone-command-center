import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "@workspace/db/schema";

const execFileAsync = promisify(execFile);

const table = (name: string) => {
  const value = (schema as Record<string, unknown>)[name];
  expect(value, `${name} must be exported by @workspace/db/schema`).toBeDefined();
  return value as Parameters<typeof getTableColumns>[0];
};

const columns = (name: string) =>
  Object.values(getTableColumns(table(name))).map((column) => column.name);

const decisionScopes = ["duplicate_identity", "field_conflict", "relationship", "unsupported_record"] as const;
const decisionValues = ["link_existing", "keep_separate", "keep_local", "use_source", "assign_parent", "keep_unlinked", "ignore_source"] as const;
const legacyDecisionValues = decisionValues.filter((decision) => decision !== "assign_parent");
const validDecisionPairs = new Set([
  "duplicate_identity:link_existing",
  "duplicate_identity:keep_separate",
  "field_conflict:keep_local",
  "field_conflict:use_source",
  "relationship:assign_parent",
  "relationship:keep_unlinked",
  "relationship:ignore_source",
  "unsupported_record:ignore_source",
]);
const invalidDecisionPairs = decisionScopes.flatMap((scope) =>
  decisionValues
    .filter((decision) => !validDecisionPairs.has(`${scope}:${decision}`))
    .map((decision) => ({ scope, decision })),
);
const legacyInvalidDecisionPairs = decisionScopes.flatMap((scope) =>
  legacyDecisionValues
    .filter((decision) => !validDecisionPairs.has(`${scope}:${decision}`))
    .map((decision) => ({ scope, decision })),
);

describe("Act organize/apply schema contract", () => {
  it("exports durable organize/apply tables and imported activity columns", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        "actReplacementOutcomes",
        "actSourceAssignments",
        "actReplacementReviewDecisions",
        "actReplacementApplyOperations",
        "actReplacementApprovalRequests",
        "actReplacementApplyBatches",
        "actImportedFieldOrigins",
        "activityAssociations",
      ]),
    );

    expect(columns("activities")).toEqual(
      expect.arrayContaining([
        "subject",
        "occurred_at",
        "timeline_sort_at",
        "date_is_import_fallback",
        "ends_at",
        "source_record_id",
        "source_version_id",
        "source_type",
      ]),
    );
    const activity = getTableColumns(table("activities"));
    expect(activity.occurredAt.notNull).toBe(false);
    expect(activity.timelineSortAt.notNull).toBe(true);
    expect(activity.timelineSortAt.hasDefault).toBe(false);
    expect(activity.occurredAt.hasDefault).toBe(false);
  });

  it("exports the exact shared organization/apply literals", async () => {
    const values = await import("./import-types");
    expect(values.actReplacementOutcomeStates).toEqual([
      "pending", "leased", "ready", "already_present", "awaiting_review",
      "unassigned", "unsupported", "ignored", "applied", "failed",
    ]);
    expect(values.actLocalEntityTypes).toEqual([
      "organization", "contact", "booking", "calling_list", "activity",
    ]);
    expect(values.actApplyTargetTypes).toEqual([
      "organization", "contact", "booking", "calling_list", "activity",
      "organization_contact", "booking_contact", "calling_list_member", "activity_association",
    ]);
    expect(values.actApplyActions).toEqual([
      "create", "link_existing", "fill_missing", "overwrite_reviewed",
      "create_relationship", "record_provenance",
    ]);
    expect(values.actOperationExecutionStates).toEqual([
      "pending", "leased", "applied", "already_present", "blocked", "failed",
    ]);
  });

  it("requires a nonblank durable decision actor and relationship decision literals", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/014_act_review_bulk_decisions.sql", import.meta.url)),
      "utf8",
    );
    const decisions = getTableColumns(table("actReplacementReviewDecisions"));

    expect(columns("actReplacementReviewDecisions")).toContain("decided_by");
    expect(decisions.decidedBy.notNull).toBe(true);
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS decided_by text");
    expect(migration).toContain("SET decided_by = 'owner'");
    expect(migration).toContain("ALTER COLUMN decided_by SET NOT NULL");
    expect(migration).toContain("btrim(decided_by) <> ''");
    expect(migration).toContain("'relationship'");
    expect(migration).toContain("'keep_unlinked'");
    expect(migration).toContain("act_replacement_review_decisions_scope_decision_valid");
    expect(migration).toContain("scope = 'field_conflict' AND decision IN ('keep_local','use_source')");
    expect(migration).toContain("scope = 'relationship' AND decision IN ('keep_unlinked','ignore_source')");
    expect(migration).toContain("scope = 'unsupported_record' AND decision = 'ignore_source'");
  });

  it("defines run-scoped durable bulk review request fingerprints", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/015_act_bulk_review_requests.sql", import.meta.url)),
      "utf8",
    );

    expect(Object.keys(schema)).toContain("actReplacementBulkReviewRequests");
    expect(columns("actReplacementBulkReviewRequests")).toEqual(expect.arrayContaining([
      "run_id", "request_key", "request_fingerprint", "requested_by", "created_at",
    ]));
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS act_replacement_bulk_review_requests");
    expect(migration).toContain("UNIQUE (run_id, request_key)");
    expect(migration).toContain("btrim(request_fingerprint) <> ''");
    expect(migration).toContain("btrim(requested_by) <> ''");
  });

  it("persists relationship parent decisions in their own issue slot", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/017_act_relationship_parent_decisions.sql", import.meta.url)),
      "utf8",
    );

    expect(columns("actReplacementReviewDecisions")).toContain("relationship_slot");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS relationship_slot text");
    expect(migration).toContain("'assign_parent'");
    expect(migration).toContain("target_entity_type IS NOT NULL");
    expect(migration).toContain("target_entity_id IS NOT NULL");
    expect(migration).toContain("coalesce(relationship_slot, field_name, '')");
    expect(migration).toMatch(
      /ADD CONSTRAINT act_replacement_review_decisions_scope_decision_valid[\s\S]*?unsupported_record'[\s\S]*?\)\s+NOT VALID,/,
    );
  });

  it("defines a forward remediation that quarantines invalid decision pairs before validation", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/018_act_review_decision_integrity.sql", import.meta.url)),
      "utf8",
    );

    expect(invalidDecisionPairs).toHaveLength(20);
    expect(migration).toContain("migration:018_invalid_scope_decision");
    expect(columns("actReplacementReviewDecisions")).toContain("request_fingerprint");
    expect(migration).toContain("legacy-unverifiable:");
    expect(migration).toContain("ALTER COLUMN request_fingerprint SET NOT NULL");
    expect(migration).toContain("active = false");
    expect(migration).toContain("superseded_at");
    expect(migration).toContain("superseded_by");
    expect(migration.indexOf("UPDATE act_replacement_review_decisions")).toBeLessThan(
      migration.indexOf("VALIDATE CONSTRAINT act_replacement_review_decisions_scope_decision_valid"),
    );
  });

  it("defines the required migration constraints and source-aware link columns", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/007_act_replacement_organize_apply.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain("act_replacement_outcomes");
    expect(migration).toContain("act_replacement_apply_batches_one_active_per_run");
    expect(migration).toContain("source_database_key");
    expect(migration).toContain("source_record_id");
    expect(migration).toContain("scope = 'field_conflict' AND field_name IS NOT NULL");
    expect(migration).toContain("superseded_at IS NULL OR superseded_by IS NOT NULL");
    expect(migration).toContain("approved_at IS NULL OR approved_by IS NOT NULL");
    expect(columns("actExternalLinks")).toEqual(
      expect.arrayContaining(["source_database_key", "source_record_id"]),
    );
    expect(migration).toContain("'act_import'");
  });

  it("keeps the approval cursor and organizer lease migration aligned with the schema", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/013_act_approval_apply_contract.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain("act_replacement_approval_requests");
    expect(migration).toContain("approval_request_key");
    expect(migration).toContain("start_cursor");
    expect(migration).toContain("act_replacement_apply_batches_run_request_key_unique");
    expect(migration).toContain("organized_at");
    expect(migration).toContain("organizer_token");
    expect(migration).toContain("organizer_lease_expires_at");
    expect(migration).toContain("attempt_token");
    expect(migration).toContain("INSERT INTO act_replacement_approval_requests");
    expect(migration).toContain("legacy_approval_batch_retired");
    expect(migration).toContain("phase = 'extract_complete'");
    expect(migration).toContain("ALTER COLUMN superseded_by TYPE text");
    expect(columns("actReplacementOutcomes")).toContain("organized_at");
    expect(columns("actReplacementRuns")).toEqual(
      expect.arrayContaining(["organizer_token", "organizer_lease_expires_at"]),
    );
    expect(columns("actReplacementApplyBatches")).toEqual(
      expect.arrayContaining(["approval_request_key", "start_cursor", "attempt_token"]),
    );
    const decisions = getTableColumns(table("actReplacementReviewDecisions"));
    expect((decisions.supersededBy as unknown as { getSQLType(): string }).getSQLType()).toBe("text");
    expect(migration.indexOf("legacy_approval_batch_retired")).toBeLessThan(
      migration.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS act_replacement_apply_batches_one_active_per_run"),
    );
  });

  it("persists nullable approval provenance without upgrading legacy approvals", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/019_act_approval_provenance.sql", import.meta.url)),
      "utf8",
    );
    const approvals = getTableColumns(table("actReplacementApprovalRequests"));

    expect(columns("actReplacementApprovalRequests")).toEqual(expect.arrayContaining([
      "approval_mode",
      "approval_mode_version",
    ]));
    expect(approvals.approvalMode.notNull).toBe(false);
    expect(approvals.approvalModeVersion.notNull).toBe(false);
    expect(approvals.approvalMode.hasDefault).toBe(false);
    expect(approvals.approvalModeVersion.hasDefault).toBe(false);
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS approval_mode text");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS approval_mode_version integer");
    expect(migration).toContain("'automatic_safe','explicit_manual'");
    expect(migration).toContain("approval_mode IS NULL AND approval_mode_version IS NULL");
    expect(migration).not.toMatch(/UPDATE\s+act_replacement_approval_requests/i);
  });

  it("registers durable automatic-review recovery ownership state", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/020_act_automatic_review_recovery.sql", import.meta.url)),
      "utf8",
    );
    const registry = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/migrations.ts", import.meta.url)),
      "utf8",
    );

    expect(registry).toContain('name: "020_act_automatic_review_recovery.sql"');
    expect(registry).toContain("'expected_manifest_digest', 'automatic_summary', 'rebuild_state'");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS rebuild_token uuid");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS rebuild_lease_expires_at timestamptz");
    expect(migration).toContain("rebuild_state IN ('pending', 'rebuilding', 'complete')");
    expect(migration).toContain("rebuild_state = 'rebuilding'");
    expect(migration).toContain("rebuild_token IS NOT NULL");
  });

  it("registers a nullable canonical manifest digest version without relabeling legacy runs", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/021_act_manifest_digest_version.sql", import.meta.url)),
      "utf8",
    );
    const registry = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/migrations.ts", import.meta.url)),
      "utf8",
    );
    const runs = getTableColumns(table("actReplacementRuns"));

    expect(registry).toContain('name: "021_act_manifest_digest_version.sql"');
    expect(runs.manifestDigestVersion.notNull).toBe(false);
    expect(runs.manifestDigestVersion.hasDefault).toBe(false);
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS manifest_digest_version text");
    expect(migration).toContain("manifest_digest_version = 'canonical-json-v1'");
    expect(migration).not.toMatch(/UPDATE\s+act_replacement_runs/i);
  });

  it("registers nullable manifest generations for durable current-plan membership", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/022_act_manifest_generation.sql", import.meta.url)),
      "utf8",
    ).catch(() => "");
    const registry = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/migrations.ts", import.meta.url)),
      "utf8",
    );
    const runs = getTableColumns(table("actReplacementRuns"));
    const operations = getTableColumns(table("actReplacementApplyOperations"));

    expect(registry).toContain('name: "022_act_manifest_generation.sql"');
    expect(runs.manifestGeneration?.notNull).toBe(false);
    expect(operations.manifestGeneration?.notNull).toBe(false);
    expect(migration).toContain("act_replacement_runs");
    expect(migration).toContain("act_replacement_apply_operations");
    expect(migration).toContain("manifest_generation uuid");
  });

  it("registers durable archive profile-import job and result tables", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/023_act_archive_profile_import.sql", import.meta.url)),
      "utf8",
    );
    const registry = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/migrations.ts", import.meta.url)),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS act_archive_profile_import_jobs");
    expect(migration).toContain("UNIQUE (run_id)");
    expect(migration).toContain("CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS act_archive_profile_import_results");
    expect(migration).toContain("UNIQUE (job_id, source_record_id)");
    expect(registry).toContain('name: "023_act_archive_profile_import.sql"');
  });

  it("allows primary pull-only contact links only for source-scoped archive records", async () => {
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/023_act_archive_profile_import.sql", import.meta.url)),
      "utf8",
    );
    const schemaSource = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/schema/index.ts", import.meta.url)),
      "utf8",
    );
    const registry = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/migrations.ts", import.meta.url)),
      "utf8",
    );

    expect(migration).toContain("act_external_links_contact_primary_sync_valid");
    expect(migration).toMatch(/is_primary[^\n]+true[^\n]+sync_mode[^\n]+pull_only/i);
    expect(migration).toMatch(/source_database_key[^\n]+is not null/i);
    expect(migration).toMatch(/source_record_id[^\n]+is not null/i);
    expect(schemaSource).toContain("act_external_links_contact_primary_sync_valid");
    expect(schemaSource).toMatch(/table\.isPrimary[^\n]+true[^\n]+table\.syncMode[^\n]+pull_only/);
    expect(schemaSource).toMatch(/table\.sourceDatabaseKey[^\n]+is not null/i);
    expect(schemaSource).toMatch(/table\.sourceRecordId[^\n]+is not null/i);
    expect(migration).toContain(
      "DROP CONSTRAINT IF EXISTS act_external_links_contact_primary_sync_valid",
    );
    expect(registry).toContain("pg_get_constraintdef");
    expect(registry).toContain("act_external_links_contact_primary_sync_valid");
  });

  it("freezes job source versions and binds archive links to exact source provenance", async () => {
    const schemaSource = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/schema/index.ts", import.meta.url)),
      "utf8",
    );
    const migration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/023_act_archive_profile_import.sql", import.meta.url)),
      "utf8",
    );
    const recoveryMigration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/024_act_archive_profile_import_recovery.sql", import.meta.url)),
      "utf8",
    );
    const forwardMigration = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/migrations/023a_act_archive_profile_import_membership.sql", import.meta.url)),
      "utf8",
    );
    const registry = await readFile(
      fileURLToPath(new URL("../../../../../lib/db/src/migrations.ts", import.meta.url)),
      "utf8",
    );

    expect(schemaSource).toContain("export const actArchiveProfileImportSources");
    expect(schemaSource).toContain('name: "act_archive_profile_import_sources_pkey"');
    expect(schemaSource).toContain('name: "act_archive_profile_import_sources_source_record_id_fk"');
    expect(schemaSource).toContain('name: "act_archive_profile_import_sources_source_version_id_fk"');
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS act_archive_profile_import_sources");
    expect(migration).toContain("to_regclass(current_schema() || '.act_archive_profile_import_jobs')");
    expect(migration).toContain("LOCK TABLE act_archive_profile_import_jobs IN EXCLUSIVE MODE");
    expect(migration.indexOf("LOCK TABLE act_archive_profile_import_jobs"))
      .toBeLessThan(migration.indexOf("ALTER TABLE act_external_links"));
    expect(migration).toContain("UNIQUE (job_id, source_record_id)");
    expect(migration).toContain("act_archive_profile_import_sources_job_phase_source_idx");
    expect(migration).toContain("act_archive_profile_import_results results");
    expect(migration).toContain("membership_snapshot_version");
    expect(migration).not.toMatch(
      /JOIN act_source_records source\s+ON source\.source_database_key = jobs\.source_database_key/i,
    );
    expect(migration).toContain("act_archive_profile_import_sources_job_id_fk");
    expect(migration).toContain("act_archive_profile_import_sources_source_record_id_fk");
    expect(migration).toContain("act_archive_profile_import_sources_source_version_id_fk");
    expect(migration.match(/ON DELETE CASCADE/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("act_external_links_archive_source_scope_fk");
    expect(migration).toContain(
      "FOREIGN KEY (source_record_id, source_database_key, source_entity_type)",
    );
    expect(migration).toContain(
      "REFERENCES act_source_records(id, source_database_key, stream_type)",
    );
    expect(registry).toContain("act_archive_profile_import_sources");
    expect(registry).toContain("act_external_links_archive_source_scope_fk");
    expect(migration).not.toMatch(/delete from act_archive_profile_import_results/i);
    expect(recoveryMigration).toMatch(/delete from act_archive_profile_import_results/i);
    expect(recoveryMigration).toContain("lease_expires_at <= clock_timestamp()");
    expect(recoveryMigration).toContain("retry_after <= clock_timestamp()");
    expect(recoveryMigration).toContain("LOCK TABLE act_archive_profile_import_jobs");
    expect(recoveryMigration).toContain("snapshot_version");
    expect(schemaSource).toContain('membershipSnapshotVersion: integer("membership_snapshot_version")');
    expect(schemaSource).not.toMatch(/membershipSnapshotVersion:[^\n]+\.default\(2\)/);
    expect(schemaSource).toContain('failureAttemptCount: integer("failure_attempt_count")');
    expect(registry).toContain('name: "024_act_archive_profile_import_recovery.sql"');
    expect(registry).toContain("membership_snapshot_version");
    const repositorySource = await readFile(
      fileURLToPath(new URL("./archive-profile-import-repository.ts", import.meta.url)),
      "utf8",
    );
    expect(repositorySource).toMatch(
      /insert into act_archive_profile_import_jobs[\s\S]+membership_snapshot_version[\s\S]+values[\s\S]+2/,
    );
    expect(recoveryMigration).not.toContain("SET DEFAULT 2");
    expect(recoveryMigration).toContain("membership_snapshot_version DROP DEFAULT");
    expect(forwardMigration).toContain("act_archive_profile_import_results results");
    expect(forwardMigration).toContain("membership_snapshot_version");
    expect(forwardMigration).not.toMatch(
      /JOIN act_source_records source\s+ON source\.source_database_key = jobs\.source_database_key/i,
    );
    expect(forwardMigration).toContain("LOCK TABLE act_archive_profile_import_jobs IN EXCLUSIVE MODE");
    expect(forwardMigration.indexOf("LOCK TABLE act_archive_profile_import_jobs"))
      .toBeLessThan(forwardMigration.indexOf("act_archive_profile_import_sources"));
    expect(forwardMigration.indexOf("ADD CONSTRAINT act_archive_profile_import_sources_pkey"))
      .toBeLessThan(forwardMigration.indexOf("ALTER TABLE act_external_links"));
    expect(forwardMigration).toContain("JOIN pg_attribute");
    expect(forwardMigration).toContain("constraint_row.conkey");
    expect(forwardMigration).toContain("constraint_row.confkey");
    expect(forwardMigration).toContain("constraint_row.confdeltype");
    expect(forwardMigration).toContain("DROP CONSTRAINT %I");
    expect(forwardMigration).toContain("managed_constraint_names");
    expect(forwardMigration).toContain("act_archive_profile_import_sources_job_id_source_record_id_key");
  });

  const postgresOnly = process.env.TEST_DATABASE_URL ? describe : describe.skip;
  postgresOnly("PostgreSQL constraint behavior", () => {
    it("runs forward membership repair before recovery when original 023 is filename-recorded", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const schemaName = `act_archive_forward_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const migrationDirectory = fileURLToPath(
        new URL("../../../../../lib/db/migrations/", import.meta.url),
      );
      const original023 = await readFile(
        fileURLToPath(new URL("./fixtures/023-original-act-archive-profile-import.sql", import.meta.url)),
        "utf8",
      );
      const migration006 = await readFile(
        fileURLToPath(new URL("../../../../../lib/db/migrations/006_act_replacement_archive.sql", import.meta.url)),
        "utf8",
      );
      try {
        await pool.query(`create schema ${schemaName}`);
        await pool.query(`set search_path to ${schemaName}, public`);
        await pool.query(migration006);
        await pool.query(`create table act_external_links (
          id uuid primary key default gen_random_uuid(), entity_type text not null,
          entity_id uuid not null, source_entity_type text not null, act_record_id text not null,
          source_database_key text, source_record_id uuid references act_source_records(id),
          is_primary boolean not null default false, sync_mode text not null default 'pull_only',
          created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
          constraint act_external_links_contact_primary_sync_valid check (
            (entity_type = 'contact' and source_entity_type = 'contact' and
              ((is_primary and sync_mode = 'two_way') or (not is_primary and sync_mode = 'pull_only')))
            or (entity_type <> 'contact' and sync_mode = 'pull_only'))
        )`);
        await pool.query(original023);
        await pool.query(`create table _custom_migrations (
          filename text primary key, applied_at timestamptz not null default now())`);
        const migrationNames = (await readdir(migrationDirectory))
          .filter((name) => name.endsWith(".sql"))
          .sort();
        const recorded = migrationNames.filter(
          (name) => name < "023a_act_archive_profile_import_membership.sql",
        );
        await pool.query(
          `insert into _custom_migrations (filename) select unnest($1::text[])`,
          [recorded],
        );

        const completedRun = await pool.query<{ id: string }>(`insert into act_replacement_runs
          (request_key, source_database_key, requested_by, page_size, phase)
          values ('completed-run', 'forward-db', 'owner', 50, 'complete_with_issues') returning id`);
        const liveRun = await pool.query<{ id: string }>(`insert into act_replacement_runs
          (request_key, source_database_key, requested_by, page_size, phase)
          values ('live-run', 'forward-db', 'owner', 50, 'complete_with_issues') returning id`);
        const source = await pool.query<{ id: string }>(`insert into act_source_records
          (source_database_key, stream_type, source_key, act_record_id,
           first_seen_run_id, last_seen_run_id, archive_completeness)
          values ('forward-db', 'company', 'company-1', 'company-act-1', $1, $1, 'complete') returning id`,
        [completedRun.rows[0]!.id]);
        const version = await pool.query<{ id: string }>(`insert into act_source_record_versions
          (source_record_id, source_database_key, fingerprint, raw_snapshot, snapshot_scope, observed_run_id)
          values ($1, 'forward-db', 'company-v1', '{"Name":"Forward Co"}', 'detail', $2) returning id`,
        [source.rows[0]!.id, completedRun.rows[0]!.id]);
        await pool.query(
          `update act_source_records set latest_version_id = $1, latest_fingerprint = 'company-v1' where id = $2`,
          [version.rows[0]!.id, source.rows[0]!.id],
        );
        const jobs = await pool.query<{ id: string; request_key: string; lease_token: string | null }>(`insert into act_archive_profile_import_jobs
          (run_id, source_database_key, request_key, requested_by, phase,
           eligible_count, processed_count, created_count, lease_owner, lease_token, lease_expires_at)
          values ($1, 'forward-db', 'completed', 'owner', 'complete', 1, 1, 1, null, null, null),
                 ($2, 'forward-db', 'live', 'owner', 'contacts', 1, 1, 1,
                  'live-worker', gen_random_uuid(), clock_timestamp() + interval '1 hour')
          returning id, request_key, lease_token`,
        [completedRun.rows[0]!.id, liveRun.rows[0]!.id]);
        for (const job of jobs.rows) {
          await pool.query(`insert into act_archive_profile_import_results
            (job_id, source_record_id, source_version_id, status, resolution_policy_version)
            values ($1, $2, $3, 'created', 'original-023')`,
          [job.id, source.rows[0]!.id, version.rows[0]!.id]);
        }

        const connection = new URL(process.env.TEST_DATABASE_URL!);
        connection.searchParams.set("options", `-c search_path=${schemaName},public`);
        if (!connection.searchParams.has("sslmode")) {
          connection.searchParams.set("sslmode", "disable");
        }
        const environment: NodeJS.ProcessEnv = {
          ...process.env,
          DATABASE_URL: connection.toString(),
        };
        delete environment.RENDER_DATABASE_URL;
        const executed = await execFileAsync(
          fileURLToPath(new URL("../../../../../lib/db/node_modules/.bin/tsx", import.meta.url)),
          [fileURLToPath(new URL("../../../../../lib/db/src/run-migrations.ts", import.meta.url))],
          { env: environment },
        );
        expect(executed.stdout).toContain("applied  023a_act_archive_profile_import_membership.sql");
        expect(executed.stdout).toContain("applied  024_act_archive_profile_import_recovery.sql");

        const upgraded = await pool.query<{
          request_key: string; phase: string; snapshot_version: number | null;
          lease_owner: string | null; lease_token: string | null; results: number; membership: number;
        }>(`select jobs.request_key, jobs.phase,
              jobs.membership_snapshot_version as snapshot_version,
              jobs.lease_owner, jobs.lease_token,
              (select count(*)::int from act_archive_profile_import_results result
               where result.job_id = jobs.id) as results,
              (select count(*)::int from act_archive_profile_import_sources member
               where member.job_id = jobs.id) as membership
            from act_archive_profile_import_jobs jobs order by jobs.request_key`);
        expect(upgraded.rows).toEqual([
          {
            request_key: "completed", phase: "complete", snapshot_version: 2,
            lease_owner: null, lease_token: null, results: 1, membership: 1,
          },
          {
            request_key: "live", phase: "contacts", snapshot_version: null,
            lease_owner: "live-worker",
            lease_token: jobs.rows.find(({ request_key }) => request_key === "live")!.lease_token,
            results: 1, membership: 1,
          },
        ]);
        const applied = await pool.query<{ filename: string }>(`select filename from _custom_migrations
          where filename in ('023a_act_archive_profile_import_membership.sql',
                             '024_act_archive_profile_import_recovery.sql')
          order by filename`);
        expect(applied.rows.map(({ filename }) => filename)).toEqual([
          "023a_act_archive_profile_import_membership.sql",
          "024_act_archive_profile_import_recovery.sql",
        ]);
      } finally {
        await pool.query(`drop schema if exists ${schemaName} cascade`);
        await pool.end();
      }
    });

    it("keeps historical jobs result-scoped through the direct API migration path", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const schemaName = `act_archive_api_forward_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const original023 = await readFile(
        fileURLToPath(new URL("./fixtures/023-original-act-archive-profile-import.sql", import.meta.url)),
        "utf8",
      );
      const migration006 = await readFile(
        fileURLToPath(new URL("../../../../../lib/db/migrations/006_act_replacement_archive.sql", import.meta.url)),
        "utf8",
      );
      try {
        await pool.query(`create schema ${schemaName}`);
        await pool.query(`set search_path to ${schemaName}, public`);
        await pool.query(migration006);
        await pool.query(`create table act_external_links (
          id uuid primary key default gen_random_uuid(), entity_type text not null,
          entity_id uuid not null, source_entity_type text not null, act_record_id text not null,
          source_database_key text, source_record_id uuid references act_source_records(id),
          is_primary boolean not null default false, sync_mode text not null default 'pull_only',
          constraint act_external_links_contact_primary_sync_valid check (
            (entity_type = 'contact' and source_entity_type = 'contact' and
              ((is_primary and sync_mode = 'two_way') or (not is_primary and sync_mode = 'pull_only')))
            or (entity_type <> 'contact' and sync_mode = 'pull_only'))
        )`);
        await pool.query(original023);
        const runs = await pool.query<{ id: string; request_key: string }>(`insert into act_replacement_runs
          (request_key, source_database_key, requested_by, page_size, phase)
          values ('api-completed-run', 'api-forward-db', 'owner', 50, 'complete_with_issues'),
                 ('api-live-run', 'api-forward-db', 'owner', 50, 'complete_with_issues')
          returning id, request_key`);
        const completedRun = runs.rows.find(({ request_key }) => request_key === "api-completed-run")!;
        const liveRun = runs.rows.find(({ request_key }) => request_key === "api-live-run")!;
        const sources = await pool.query<{ id: string; source_key: string }>(`insert into act_source_records
          (source_database_key, stream_type, source_key, act_record_id,
           first_seen_run_id, last_seen_run_id, archive_completeness)
          values ('api-forward-db', 'company', 'result-source', 'result-act', $1, $1, 'complete'),
                 ('api-forward-db', 'company', 'later-source', 'later-act', $1, $1, 'complete')
          returning id, source_key`, [completedRun.id]);
        const resultSource = sources.rows.find(({ source_key }) => source_key === "result-source")!;
        const laterSource = sources.rows.find(({ source_key }) => source_key === "later-source")!;
        const resultVersion = await pool.query<{ id: string }>(`insert into act_source_record_versions
          (source_record_id, source_database_key, fingerprint, raw_snapshot, snapshot_scope, observed_run_id)
          values ($1, 'api-forward-db', 'result-v1', '{}', 'detail', $2) returning id`,
        [resultSource.id, completedRun.id]);
        const laterVersion = await pool.query<{ id: string }>(`insert into act_source_record_versions
          (source_record_id, source_database_key, fingerprint, raw_snapshot, snapshot_scope, observed_run_id)
          values ($1, 'api-forward-db', 'later-v1', '{}', 'detail', $2) returning id`,
        [laterSource.id, completedRun.id]);
        await pool.query(`update act_source_records set latest_version_id = $1, latest_fingerprint = 'result-v1'
          where id = $2`, [resultVersion.rows[0]!.id, resultSource.id]);
        await pool.query(`update act_source_records set latest_version_id = $1, latest_fingerprint = 'later-v1'
          where id = $2`, [laterVersion.rows[0]!.id, laterSource.id]);
        const jobs = await pool.query<{ id: string; request_key: string; lease_token: string | null }>(`insert into act_archive_profile_import_jobs
          (run_id, source_database_key, request_key, requested_by, phase,
           eligible_count, processed_count, created_count, lease_owner, lease_token, lease_expires_at)
          values ($1, 'api-forward-db', 'api-completed', 'owner', 'complete', 1, 1, 1, null, null, null),
                 ($2, 'api-forward-db', 'api-live', 'owner', 'contacts', 1, 1, 1,
                  'api-live-worker', gen_random_uuid(), clock_timestamp() + interval '1 hour')
          returning id, request_key, lease_token`, [completedRun.id, liveRun.id]);
        for (const job of jobs.rows) {
          await pool.query(`insert into act_archive_profile_import_results
            (job_id, source_record_id, source_version_id, status, resolution_policy_version)
            values ($1, $2, $3, 'created', 'original-023')`,
          [job.id, resultSource.id, resultVersion.rows[0]!.id]);
        }

        const migrationsModuleUrl = new URL("../../../../../lib/db/src/migrations.ts", import.meta.url);
        const { loadActReviewMigrations, runActReviewMigrations } = await import(migrationsModuleUrl.href);
        const migrations = (await loadActReviewMigrations()).filter(
          ({ name }: { name: string }) => name === "023_act_archive_profile_import.sql"
            || name === "023a_act_archive_profile_import_membership.sql"
            || name === "024_act_archive_profile_import_recovery.sql",
        );
        const workerClient = await pool.connect();
        const migrationClient = await pool.connect();
        let migrationPromise: Promise<string[]> | undefined;
        try {
          await workerClient.query(`set search_path to ${schemaName}, public`);
          await migrationClient.query(`set search_path to ${schemaName}, public`);
          await workerClient.query("begin");
          const liveJob = jobs.rows.find(({ request_key }) => request_key === "api-live")!;
          await workerClient.query(
            `select id from act_archive_profile_import_jobs where id = $1 for update`,
            [liveJob.id],
          );
          const migrationPid = await migrationClient.query<{ pid: number }>(
            `select pg_backend_pid() as pid`,
          );
          const migrationPool = {
            async connect() {
              return {
                query: (sql: string) => migrationClient.query(sql),
                release() {},
              };
            },
          };
          migrationPromise = runActReviewMigrations({
            pool: migrationPool as never,
            migrations,
          });

          let waitingForJobs = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const lock = await pool.query<{ waiting: boolean }>(`select exists (
              select 1 from pg_locks
              where pid = $1 and relation = to_regclass($2)
                and mode = 'ExclusiveLock' and not granted
            ) as waiting`, [
              migrationPid.rows[0]!.pid,
              `${schemaName}.act_archive_profile_import_jobs`,
            ]);
            waitingForJobs = lock.rows[0]!.waiting;
            if (waitingForJobs) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waitingForJobs).toBe(true);
          const heldLocks = await pool.query<{ advisory: boolean; link_table: boolean }>(`select
            exists (select 1 from pg_locks where pid = $1 and locktype = 'advisory' and granted)
              as advisory,
            exists (select 1 from pg_locks where pid = $1 and relation = to_regclass($2) and granted)
              as link_table`, [
                migrationPid.rows[0]!.pid,
                `${schemaName}.act_external_links`,
              ]);
          expect(heldLocks.rows[0]).toEqual({ advisory: true, link_table: false });

          await workerClient.query("commit");
          expect(await migrationPromise).toEqual([
            "023_act_archive_profile_import.sql",
            "024_act_archive_profile_import_recovery.sql",
          ]);
        } finally {
          await workerClient.query("rollback").catch(() => undefined);
          if (migrationPromise) await migrationPromise.catch(() => undefined);
          workerClient.release();
          migrationClient.release();
        }
        const state = await pool.query<{
          request_key: string; phase: string; eligible_count: number; processed_count: number;
          membership: number; snapshot_version: number | null; lease_owner: string | null;
          lease_token: string | null; later_membership: number;
        }>(`select jobs.request_key, jobs.phase, jobs.eligible_count, jobs.processed_count,
            jobs.membership_snapshot_version as snapshot_version, jobs.lease_owner, jobs.lease_token,
            (select count(*)::int from act_archive_profile_import_sources member
             where member.job_id = jobs.id) as membership,
            (select count(*)::int from act_archive_profile_import_sources member
             where member.job_id = jobs.id and member.source_record_id = $1) as later_membership
          from act_archive_profile_import_jobs jobs order by jobs.request_key`, [laterSource.id]);
        expect(state.rows).toEqual([
          {
            request_key: "api-completed", phase: "complete", eligible_count: 1, processed_count: 1,
            membership: 1, snapshot_version: 2, lease_owner: null, lease_token: null,
            later_membership: 0,
          },
          {
            request_key: "api-live", phase: "contacts", eligible_count: 1, processed_count: 1,
            membership: 1, snapshot_version: null, lease_owner: "api-live-worker",
            lease_token: jobs.rows.find(({ request_key }) => request_key === "api-live")!.lease_token,
            later_membership: 0,
          },
        ]);
      } finally {
        await pool.query(`drop schema if exists ${schemaName} cascade`);
        await pool.end();
      }
    });

    it("upgrades contact link checks without enabling unscoped primary pull links", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const schemaName = `act_archive_link_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const migration = await readFile(
        fileURLToPath(new URL("../../../../../lib/db/migrations/023_act_archive_profile_import.sql", import.meta.url)),
        "utf8",
      );
      const forwardMigration = await readFile(
        fileURLToPath(new URL("../../../../../lib/db/migrations/023a_act_archive_profile_import_membership.sql", import.meta.url)),
        "utf8",
      );
      try {
        await pool.query(`create schema ${schemaName}`);
        await pool.query(`set search_path to ${schemaName}, public`);
        await pool.query(`
          create table act_replacement_runs (
            id uuid primary key default gen_random_uuid(), source_database_key text not null,
            unique (id, source_database_key)
          );
          create table act_source_records (
            id uuid primary key default gen_random_uuid(), source_database_key text not null,
            stream_type text not null, latest_version_id uuid,
            unique (id, source_database_key), unique (id, source_database_key, stream_type)
          );
          create table act_source_record_versions (
            id uuid primary key default gen_random_uuid(), source_record_id uuid not null,
            unique (id, source_record_id)
          );
          create table act_external_links (
            id uuid primary key default gen_random_uuid(), entity_type text not null,
            source_entity_type text not null, entity_id uuid not null, act_record_id text not null,
            source_database_key text, source_record_id uuid,
            is_primary boolean not null default false, sync_mode text not null default 'pull_only',
            constraint act_external_links_contact_primary_sync_valid check (
              (entity_type = 'contact' and source_entity_type = 'contact' and
                ((is_primary = true and sync_mode = 'two_way') or
                 (is_primary = false and sync_mode = 'pull_only')))
              or (entity_type <> 'contact' and sync_mode = 'pull_only')
            )
          );
        `);
        await pool.query(migration);
        const run = await pool.query<{ id: string }>(
          `insert into act_replacement_runs (source_database_key) values ('archive-db') returning id`,
        );
        const source = await pool.query<{ id: string }>(
          `insert into act_source_records (source_database_key, stream_type)
           values ('archive-db', 'contact') returning id`,
        );
        const targetIds = Array.from({ length: 4 }, () => randomUUID());

        await expect(pool.query(
          `insert into act_external_links
             (entity_type, source_entity_type, entity_id, act_record_id, is_primary, sync_mode)
           values ('contact', 'contact', $1, 'legacy-two-way', true, 'two_way'),
                  ('contact', 'contact', $2, 'legacy-pull', false, 'pull_only')`,
          targetIds.slice(0, 2),
        )).resolves.toBeDefined();
        await expect(pool.query(
          `insert into act_external_links
             (entity_type, source_entity_type, entity_id, act_record_id,
              source_database_key, source_record_id, is_primary, sync_mode)
           values ('contact', 'contact', $1, 'wrong-db', 'other-db', $2, true, 'pull_only')`,
          [randomUUID(), source.rows[0]!.id],
        )).rejects.toMatchObject({ code: "23503" });
        await expect(pool.query(
          `insert into act_external_links
             (entity_type, source_entity_type, entity_id, act_record_id,
              source_database_key, source_record_id, is_primary, sync_mode)
           values ('contact', 'contact', $1, 'archive-pull', 'archive-db', $2, true, 'pull_only')`,
          [targetIds[2], source.rows[0]!.id],
        )).resolves.toBeDefined();
        await expect(pool.query(
          `insert into act_external_links
             (entity_type, source_entity_type, entity_id, act_record_id,
              source_database_key, is_primary, sync_mode)
           values ('contact', 'contact', $1, 'unscoped-pull', 'archive-db', true, 'pull_only')`,
          [targetIds[3]],
        )).rejects.toMatchObject({ code: "23514" });

        const version = await pool.query<{ id: string }>(
          `insert into act_source_record_versions (source_record_id) values ($1) returning id`,
          [source.rows[0]!.id],
        );
        await pool.query(`update act_source_records set latest_version_id = $1 where id = $2`, [
          version.rows[0]!.id,
          source.rows[0]!.id,
        ]);
        const completedRun = await pool.query<{ id: string }>(
          `insert into act_replacement_runs (source_database_key) values ('archive-db') returning id`,
        );
        const liveRun = await pool.query<{ id: string }>(
          `insert into act_replacement_runs (source_database_key) values ('archive-db') returning id`,
        );
        const jobs = await pool.query<{ id: string; phase: string }>(
          `insert into act_archive_profile_import_jobs
            (run_id, source_database_key, request_key, requested_by, phase,
             eligible_count, processed_count, created_count, cursor_source_record_id,
             lease_owner, lease_token, lease_expires_at)
           values ($1, 'archive-db', 'incomplete', 'owner', 'contacts', 99, 1, 1, $3, null, null, null),
                  ($2, 'archive-db', 'completed', 'owner', 'complete', 1, 1, 1, null, null, null, null),
                  ($4, 'archive-db', 'live', 'owner', 'contacts', 1, 1, 1, $3,
                   'old-worker', gen_random_uuid(), clock_timestamp() + interval '1 hour')
           returning id, phase`,
          [run.rows[0]!.id, completedRun.rows[0]!.id, source.rows[0]!.id, liveRun.rows[0]!.id],
        );
        for (const job of jobs.rows) {
          await pool.query(
            `insert into act_archive_profile_import_results
              (job_id, source_record_id, source_version_id, status, resolution_policy_version)
             values ($1, $2, $3, 'created', 'legacy')`,
            [job.id, source.rows[0]!.id, version.rows[0]!.id],
          );
        }

        // Supported deployment ordering: Drizzle schema push adds the nullable
        // columns before the custom migration runner evaluates 024 readiness.
        await pool.query(`alter table act_archive_profile_import_jobs
          add column membership_snapshot_version integer,
          add column failure_attempt_count integer not null default 0`);
        const afterSchemaPush = await pool.query<{ claimable: number; stale: number }>(`select
          count(*) filter (where membership_snapshot_version = 2)::int as claimable,
          count(*) filter (where membership_snapshot_version is null)::int as stale
          from act_archive_profile_import_jobs`);
        expect(afterSchemaPush.rows[0]).toEqual({ claimable: 0, stale: 3 });

        const migrationsModuleUrl = new URL("../../../../../lib/db/src/migrations.ts", import.meta.url);
        const { loadActReviewMigrations, runActReviewMigrations } = await import(migrationsModuleUrl.href);
        const recovery = (await loadActReviewMigrations()).filter(
          ({ name }: { name: string }) => name === "024_act_archive_profile_import_recovery.sql",
        );
        expect(await runActReviewMigrations({ pool: pool as never, migrations: recovery })).toEqual([
          "024_act_archive_profile_import_recovery.sql",
        ]);
        const upgraded = await pool.query<{
          phase: string; eligible_count: number; processed_count: number;
          results: number; membership: number; snapshot_version: number | null; lease_owner: string | null;
        }>(`select jobs.phase, jobs.eligible_count, jobs.processed_count,
              (select count(*)::int from act_archive_profile_import_results result
               where result.job_id = jobs.id) as results,
              (select count(*)::int from act_archive_profile_import_sources member
               where member.job_id = jobs.id) as membership,
              jobs.membership_snapshot_version as snapshot_version, jobs.lease_owner
            from act_archive_profile_import_jobs jobs order by jobs.request_key`);
        expect(upgraded.rows).toEqual([
          { phase: "complete", eligible_count: 1, processed_count: 1, results: 1, membership: 0, snapshot_version: 2, lease_owner: null },
          { phase: "companies", eligible_count: 1, processed_count: 0, results: 0, membership: 1, snapshot_version: 2, lease_owner: null },
          { phase: "contacts", eligible_count: 1, processed_count: 1, results: 1, membership: 0, snapshot_version: null, lease_owner: "old-worker" },
        ]);
        await pool.query(
          `update act_archive_profile_import_jobs set lease_expires_at = clock_timestamp() - interval '1 second'
           where request_key = 'live'`,
        );
        expect(await runActReviewMigrations({ pool: pool as never, migrations: recovery })).toEqual([
          "024_act_archive_profile_import_recovery.sql",
        ]);
        expect(await runActReviewMigrations({ pool: pool as never, migrations: recovery })).toEqual([]);
        const recoveredLive = await pool.query<{
          phase: string; processed_count: number; lease_owner: string | null;
          snapshot_version: number; results: number; membership: number;
        }>(`select jobs.phase, jobs.processed_count, jobs.lease_owner,
              jobs.membership_snapshot_version as snapshot_version,
              (select count(*)::int from act_archive_profile_import_results result
               where result.job_id = jobs.id) as results,
              (select count(*)::int from act_archive_profile_import_sources member
               where member.job_id = jobs.id) as membership
            from act_archive_profile_import_jobs jobs where request_key = 'live'`);
        expect(recoveredLive.rows[0]).toEqual({
          phase: "companies", processed_count: 0, lease_owner: null,
          snapshot_version: 2, results: 0, membership: 1,
        });
        const snapshotColumn = await pool.query<{ column_default: string | null }>(
          `select column_default from information_schema.columns
           where table_schema = current_schema()
             and table_name = 'act_archive_profile_import_jobs'
             and column_name = 'membership_snapshot_version'`,
        );
        expect(snapshotColumn.rows[0]!.column_default).toBeNull();

        const laterSource = await pool.query<{ id: string }>(
          `insert into act_source_records (source_database_key, stream_type)
           values ('archive-db', 'company') returning id`,
        );
        const laterVersion = await pool.query<{ id: string }>(
          `insert into act_source_record_versions (source_record_id) values ($1) returning id`,
          [laterSource.rows[0]!.id],
        );
        await pool.query(`update act_source_records set latest_version_id = $1 where id = $2`, [
          laterVersion.rows[0]!.id,
          laterSource.rows[0]!.id,
        ]);
        await pool.query(`create table _custom_migrations (
          filename text primary key, applied_at timestamptz not null default now())`);
        await pool.query(`insert into _custom_migrations (filename) values
          ('023_act_archive_profile_import.sql'),
          ('024_act_archive_profile_import_recovery.sql')`);
        const frozenStateSql = `select jsonb_agg(jsonb_build_object(
            'id', jobs.id, 'phase', jobs.phase, 'eligible', jobs.eligible_count,
            'processed', jobs.processed_count, 'created', jobs.created_count,
            'linked', jobs.linked_count, 'updated', jobs.updated_count,
            'alreadyImported', jobs.already_imported_count,
            'preserved', jobs.preserved_count, 'retryable', jobs.retryable_failure_count,
            'failureAttempts', jobs.failure_attempt_count,
            'snapshotVersion', jobs.membership_snapshot_version,
            'cursor', jobs.cursor_source_record_id, 'retryAfter', jobs.retry_after,
            'leaseOwner', jobs.lease_owner, 'leaseToken', jobs.lease_token,
            'leaseExpiresAt', jobs.lease_expires_at, 'lastError', jobs.last_error_code,
            'completedAt', jobs.completed_at, 'createdAt', jobs.created_at,
            'updatedAt', jobs.updated_at,
            'membership', coalesce((select jsonb_agg(jsonb_build_object(
              'sourceRecordId', member.source_record_id,
              'sourceVersionId', member.source_version_id,
              'phase', member.phase) order by member.source_record_id)
              from act_archive_profile_import_sources member where member.job_id = jobs.id), '[]'::jsonb),
            'results', coalesce((select jsonb_agg(to_jsonb(result) order by result.id)
              from act_archive_profile_import_results result where result.job_id = jobs.id), '[]'::jsonb)
          ) order by jobs.id) as state from act_archive_profile_import_jobs jobs`;
        const beforeForward = await pool.query<{ state: unknown }>(frozenStateSql);

        await pool.query(forwardMigration);

        const afterForward = await pool.query<{ state: unknown }>(frozenStateSql);
        expect(afterForward.rows[0]!.state).toEqual(beforeForward.rows[0]!.state);
        const laterMembership = await pool.query<{ count: number }>(
          `select count(*)::int as count from act_archive_profile_import_sources
           where source_record_id = $1`,
          [laterSource.rows[0]!.id],
        );
        expect(laterMembership.rows[0]!.count).toBe(0);

        await pool.query(`alter table act_archive_profile_import_sources
          drop constraint act_archive_profile_import_sources_job_database_fk,
          drop constraint act_archive_profile_import_sources_source_database_fk,
          drop constraint act_archive_profile_import_sources_version_owner_fk,
          drop constraint act_archive_profile_import_sources_phase_valid,
          drop constraint act_archive_profile_import_sources_job_id_fk,
          drop constraint act_archive_profile_import_sources_source_record_id_fk,
          drop constraint act_archive_profile_import_sources_source_version_id_fk,
          drop constraint act_archive_profile_import_sources_pkey`);
        await pool.query(`drop index act_archive_profile_import_sources_job_phase_source_idx`);
        await pool.query(`alter table act_archive_profile_import_jobs
          drop constraint act_archive_profile_import_jobs_id_database_unique`);
        await pool.query(`alter table act_external_links
          drop constraint act_external_links_contact_primary_sync_valid,
          drop constraint act_external_links_archive_source_scope_fk`);
        const forward = (await loadActReviewMigrations()).filter(
          ({ name }: { name: string }) => name === "023a_act_archive_profile_import_membership.sql",
        );
        expect(await runActReviewMigrations({ pool: pool as never, migrations: forward })).toEqual([
          "023a_act_archive_profile_import_membership.sql",
        ]);
        expect(await runActReviewMigrations({ pool: pool as never, migrations: forward })).toEqual([]);
        const afterPartialRepair = await pool.query<{ state: unknown }>(frozenStateSql);
        expect(afterPartialRepair.rows[0]!.state).toEqual(beforeForward.rows[0]!.state);

        // Model a legacy Drizzle schema push: generated identifiers exceed
        // PostgreSQL's identifier limit and the single-column FKs used the
        // old restrictive delete action. Structural discovery must remove
        // the truncated names rather than relying on guessed literals.
        await pool.query(`alter table act_archive_profile_import_sources
          drop constraint act_archive_profile_import_sources_job_id_fk,
          drop constraint act_archive_profile_import_sources_source_record_id_fk,
          drop constraint act_archive_profile_import_sources_source_version_id_fk,
          drop constraint act_archive_profile_import_sources_pkey,
          add constraint act_archive_profile_import_sources_job_id_source_record_id_pk
            primary key (job_id, source_record_id),
          add constraint act_archive_profile_import_sources_job_id_act_archive_profile_import_jobs_id_fk
            foreign key (job_id) references act_archive_profile_import_jobs(id) on delete cascade,
          add constraint act_archive_profile_import_sources_source_record_id_act_source_records_id_fk
            foreign key (source_record_id) references act_source_records(id) on delete restrict,
          add constraint act_archive_profile_import_sources_source_version_id_act_source_record_versions_id_fk
            foreign key (source_version_id) references act_source_record_versions(id) on delete restrict`);
        expect(await runActReviewMigrations({ pool: pool as never, migrations: forward })).toEqual([
          "023a_act_archive_profile_import_membership.sql",
        ]);
        expect(await runActReviewMigrations({ pool: pool as never, migrations: forward })).toEqual([]);
        const normalizedInline = await pool.query<{ conname: string; confdeltype: string }>(`
          select conname, confdeltype from pg_constraint
          where conrelid = 'act_archive_profile_import_sources'::regclass
            and conname in (
              'act_archive_profile_import_sources_job_id_fk',
              'act_archive_profile_import_sources_source_record_id_fk',
              'act_archive_profile_import_sources_source_version_id_fk'
            ) order by conname`);
        expect(normalizedInline.rows).toEqual([
          { conname: "act_archive_profile_import_sources_job_id_fk", confdeltype: "c" },
          { conname: "act_archive_profile_import_sources_source_record_id_fk", confdeltype: "c" },
          { conname: "act_archive_profile_import_sources_source_version_id_fk", confdeltype: "c" },
        ]);
        const restrictiveInline = await pool.query<{ count: number }>(`
          select count(*)::int as count
          from pg_constraint constraint_catalog
          join lateral unnest(constraint_catalog.conkey) key(attnum) on true
          join pg_attribute attribute
            on attribute.attrelid = constraint_catalog.conrelid and attribute.attnum = key.attnum
          where constraint_catalog.conrelid = 'act_archive_profile_import_sources'::regclass
            and constraint_catalog.contype = 'f'
            and attribute.attname in ('job_id', 'source_record_id', 'source_version_id')
            and array_length(constraint_catalog.conkey, 1) = 1
            and constraint_catalog.confdeltype <> 'c'`);
        expect(restrictiveInline.rows[0]!.count).toBe(0);

        // Expected names are not sufficient: corrupt every object class under
        // its expected name and require a single forward run to normalize it.
        await pool.query(`alter table act_archive_profile_import_sources
          drop constraint act_archive_profile_import_sources_job_database_fk,
          drop constraint act_archive_profile_import_sources_source_database_fk,
          drop constraint act_archive_profile_import_sources_version_owner_fk,
          drop constraint act_archive_profile_import_sources_phase_valid,
          drop constraint act_archive_profile_import_sources_job_id_fk,
          drop constraint act_archive_profile_import_sources_source_record_id_fk,
          drop constraint act_archive_profile_import_sources_source_version_id_fk,
          drop constraint act_archive_profile_import_sources_pkey`);
        await pool.query(`drop index act_archive_profile_import_sources_job_phase_source_idx`);
        await pool.query(`alter table act_archive_profile_import_jobs
          drop constraint act_archive_profile_import_jobs_id_database_unique`);
        await pool.query(`alter table act_external_links
          drop constraint act_external_links_contact_primary_sync_valid,
          drop constraint act_external_links_archive_source_scope_fk`);
        await pool.query(`alter table act_archive_profile_import_jobs
          add constraint act_archive_profile_import_jobs_id_database_unique
            unique (source_database_key, id)`);
        await pool.query(`alter table act_archive_profile_import_sources
          add constraint act_archive_profile_import_sources_pkey primary key (job_id, source_version_id),
          add constraint act_archive_profile_import_sources_job_id_fk
            foreign key (source_record_id) references act_source_records(id),
          add constraint act_archive_profile_import_sources_source_record_id_fk
            foreign key (source_version_id) references act_source_record_versions(id),
          add constraint act_archive_profile_import_sources_source_version_id_fk
            foreign key (job_id) references act_archive_profile_import_jobs(id),
          add constraint act_archive_profile_import_sources_job_database_fk
            foreign key (job_id) references act_archive_profile_import_jobs(id),
          add constraint act_archive_profile_import_sources_source_database_fk
            foreign key (source_record_id) references act_source_records(id),
          add constraint act_archive_profile_import_sources_version_owner_fk
            foreign key (source_version_id) references act_source_record_versions(id),
          add constraint act_archive_profile_import_sources_job_id_source_record_id_key
            unique (source_record_id, job_id),
          add constraint act_archive_profile_import_sources_phase_valid
            check (created_at is not null)`);
        await pool.query(`create index act_archive_profile_import_sources_job_phase_source_idx
          on act_archive_profile_import_sources (phase)`);
        await pool.query(`alter table act_external_links
          add constraint act_external_links_contact_primary_sync_valid check (
            (
              entity_type = 'contact' and source_entity_type = 'contact' and (
                (is_primary = true and sync_mode = 'two_way')
                or (is_primary = false and sync_mode = 'pull_only')
                or (is_primary = true and sync_mode = 'pull_only'
                  and source_database_key is not null and source_record_id is not null)
              )
            )
            or (entity_type <> 'contact' and sync_mode = 'pull_only')
            or source_database_key is null
          ),
          add constraint act_external_links_archive_source_scope_fk
            foreign key (source_record_id) references act_source_records(id)`);
        expect(await runActReviewMigrations({ pool: pool as never, migrations: forward })).toEqual([
          "023a_act_archive_profile_import_membership.sql",
        ]);
        expect(await runActReviewMigrations({ pool: pool as never, migrations: forward })).toEqual([]);
        const afterMalformedRepair = await pool.query<{ state: unknown }>(frozenStateSql);
        expect(afterMalformedRepair.rows[0]!.state).toEqual(beforeForward.rows[0]!.state);
        const identityConstraints = await pool.query<{ count: number }>(`
          select count(*)::int as count from pg_constraint constraint_catalog
          where constraint_catalog.conrelid = 'act_archive_profile_import_sources'::regclass
            and constraint_catalog.contype in ('p', 'u')
            and (select array_agg(attribute.attname order by key_column.ordinality)
                 from unnest(constraint_catalog.conkey) with ordinality key_column(attnum, ordinality)
                 join pg_attribute attribute on attribute.attrelid = constraint_catalog.conrelid
                   and attribute.attnum = key_column.attnum)
                @> array['job_id', 'source_record_id']::name[]`);
        expect(identityConstraints.rows[0]!.count).toBe(1);
        expect(run.rows[0]!.id).toEqual(expect.any(String));
      } finally {
        await pool.query(`drop schema if exists ${schemaName} cascade`);
        await pool.end();
      }
    });

    it("allows terminal batches sequentially but only one queued/applying batch", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      try {
        const result = await pool.query<{ indexname: string }>(
          `select indexname from pg_indexes where indexname in
           ('act_replacement_apply_batches_one_active_per_run',
            'act_external_links_database_source_record_unique')`,
        );
        const names = result.rows.map((row) => row.indexname);
        expect(names).toEqual(expect.arrayContaining([
          "act_replacement_apply_batches_one_active_per_run",
          "act_external_links_database_source_record_unique",
        ]));
      } finally {
        await pool.end();
      }
    });

    it("upgrades legacy queued approvals and abandoned organizing runs", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const schemaName = `act_upgrade_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const migration = await readFile(fileURLToPath(new URL("../../../../../lib/db/migrations/013_act_approval_apply_contract.sql", import.meta.url)), "utf8");
      try {
        await pool.query(`create schema ${schemaName}`);
        await pool.query(`set search_path to ${schemaName}, public`);
        await pool.query(`
          create table act_replacement_runs (id uuid primary key, phase text not null, summary jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
          create table act_replacement_outcomes (id uuid primary key default gen_random_uuid());
          create table act_replacement_apply_batches (
            id uuid primary key default gen_random_uuid(), request_key text not null unique,
            run_id uuid not null references act_replacement_runs(id), manifest_digest text not null,
            selected_operation_ids jsonb not null default '[]'::jsonb,
            dependency_closed_operation_ids jsonb not null default '[]'::jsonb,
            selected_count integer not null default 0, dependency_count integer not null default 0,
            rejected_count integer not null default 0, state text not null default 'queued',
            lease_owner text, lease_expires_at timestamptz, last_error_code text,
            completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
          );
          create unique index act_replacement_apply_batches_one_active_per_run on act_replacement_apply_batches(run_id) where state in ('queued','applying');
          insert into act_replacement_runs (id, phase, summary) values ('11111111-1111-1111-1111-111111111111', 'organizing', '{"manifestDigest":"digest-1"}');
          insert into act_replacement_apply_batches (request_key, run_id, manifest_digest, selected_operation_ids, dependency_closed_operation_ids, selected_count)
          values ('ui-approval', '11111111-1111-1111-1111-111111111111', 'digest-1', '["op-1"]', '["op-1"]', 1);
        `);
        await pool.query(migration);
        const approval = await pool.query(`select request_key, dependency_closed_operation_ids from act_replacement_approval_requests`);
        const batch = await pool.query(`select state, last_error_code from act_replacement_apply_batches`);
        const run = await pool.query(`select phase, organizer_token from act_replacement_runs`);
        expect(approval.rows).toEqual([expect.objectContaining({ request_key: "ui-approval", dependency_closed_operation_ids: ["op-1"] })]);
        expect(batch.rows).toEqual([expect.objectContaining({ state: "complete_with_issues", last_error_code: "legacy_approval_batch_retired" })]);
        expect(run.rows).toEqual([expect.objectContaining({ phase: "extract_complete", organizer_token: null })]);
      } finally {
        await pool.query(`drop schema if exists ${schemaName} cascade`);
        await pool.end();
      }
    });

    it("runs migrations 014 through 018 with every legacy-invalid decision pair", async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const client = await pool.connect();
      const schemaName = `act_decision_upgrade_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const migrations = await Promise.all(
        [
          "014_act_review_bulk_decisions.sql",
          "015_act_bulk_review_requests.sql",
          "016_act_review_conflict_proof.sql",
          "017_act_relationship_parent_decisions.sql",
          "018_act_review_decision_integrity.sql",
        ].map((filename) => readFile(
          fileURLToPath(new URL(`../../../../../lib/db/migrations/${filename}`, import.meta.url)),
          "utf8",
        )),
      );
      try {
        await client.query(`create schema ${schemaName}`);
        await client.query(`set search_path to ${schemaName}, public`);
        await client.query(`
          create table act_replacement_runs (
            id uuid primary key default gen_random_uuid()
          );
          create table act_replacement_outcomes (
            id uuid primary key default gen_random_uuid(),
            state text not null default 'pending'
          );
          create table act_replacement_review_decisions (
            id uuid primary key default gen_random_uuid(),
            source_record_id uuid not null default gen_random_uuid(),
            scope text not null,
            decision text not null,
            request_key text not null default gen_random_uuid()::text,
            field_name text,
            target_entity_type text,
            target_entity_id uuid,
            active boolean not null default true,
            superseded_at timestamptz,
            superseded_by text,
            created_at timestamptz not null default now()
          )
        `);
        expect(legacyInvalidDecisionPairs).toHaveLength(17);
        for (const pair of legacyInvalidDecisionPairs) {
          await client.query(
            `insert into act_replacement_review_decisions (scope, decision) values ($1, $2)`,
            [pair.scope, pair.decision],
          );
        }

        for (const migration of migrations) {
          await client.query(migration);
        }

        const quarantined = await client.query<{
          scope: string;
          decision: string;
          active: boolean;
          superseded_at: Date | null;
          superseded_by: string | null;
        }>(`select scope, decision, active, superseded_at, superseded_by from act_replacement_review_decisions`);
        expect(quarantined.rows).toHaveLength(legacyInvalidDecisionPairs.length);
        expect(quarantined.rows).toEqual(expect.arrayContaining(legacyInvalidDecisionPairs.map((pair) => expect.objectContaining({
          ...pair,
          active: false,
          superseded_at: expect.any(Date),
          superseded_by: "migration:018_invalid_scope_decision",
        }))));
        const constraint = await client.query<{ convalidated: boolean }>(`
          select convalidated from pg_constraint
          where conname = 'act_replacement_review_decisions_scope_decision_valid'
        `);
        expect(constraint.rows).toEqual([{ convalidated: true }]);
        for (const pair of invalidDecisionPairs) {
          await expect(client.query(
            `insert into act_replacement_review_decisions
               (scope, decision, request_fingerprint, decided_by)
             values ($1, $2, 'invalid-pair-test', 'contract-test')`,
            [pair.scope, pair.decision],
          )).rejects.toMatchObject({ code: "23514" });
        }
        for (const pair of [...validDecisionPairs].map((value) => {
          const [scope, decision] = value.split(":");
          return { scope: scope!, decision: decision! };
        })) {
          await expect(client.query(
            `insert into act_replacement_review_decisions
               (scope, decision, request_fingerprint, decided_by, relationship_slot, target_entity_type, target_entity_id)
             values ($1, $2, 'valid-pair-test', 'contract-test', $3, $4, $5)`,
            pair.decision === "assign_parent"
              ? [pair.scope, pair.decision, "organization", "organization", "11111111-1111-1111-1111-111111111111"]
              : [pair.scope, pair.decision, null, null, null],
          )).resolves.toBeDefined();
        }
      } finally {
        await client.query("rollback");
        await client.query(`drop schema if exists ${schemaName} cascade`);
        client.release();
        await pool.end();
      }
    });
  });
});
