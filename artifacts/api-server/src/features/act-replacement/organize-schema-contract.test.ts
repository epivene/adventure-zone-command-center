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
