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
  });
});
