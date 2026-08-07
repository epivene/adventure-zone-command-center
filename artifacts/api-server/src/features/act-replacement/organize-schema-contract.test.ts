import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "@workspace/db/schema";

const table = (name: string) => {
  const value = (schema as Record<string, unknown>)[name];
  expect(value, `${name} must be exported by @workspace/db/schema`).toBeDefined();
  return value as Parameters<typeof getTableColumns>[0];
};

const columns = (name: string) =>
  Object.values(getTableColumns(table(name))).map((column) => column.name);

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
      "unassigned", "unsupported", "applied", "failed",
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

  const postgresOnly = process.env.TEST_DATABASE_URL ? describe : describe.skip;
  postgresOnly("PostgreSQL constraint behavior", () => {
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
  });
});
