import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActRecoveryReviewService } from "./review-service";

const RUN_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000001";
const STALE_VERSION_ID = "30000000-0000-4000-8000-000000000099";
const TARGET_ID = "40000000-0000-4000-8000-000000000001";
const ITEM_ID = "50000000-0000-4000-8000-000000000001";

let client: PGlite;
let database: ReturnType<typeof drizzle>;

beforeEach(async () => {
  client = new PGlite();
  database = drizzle(client);
  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY,
      source_database_key text NOT NULL,
      stream_type text NOT NULL,
      act_record_id text,
      latest_version_id uuid,
      relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE act_source_record_versions (
      id uuid PRIMARY KEY,
      source_record_id uuid NOT NULL,
      raw_snapshot jsonb NOT NULL,
      fetched_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE act_archive_recovery_runs (
      id uuid PRIMARY KEY,
      source_database_key text NOT NULL,
      requested_by text NOT NULL,
      request_key text NOT NULL,
      state text NOT NULL DEFAULT 'running',
      candidate_count int NOT NULL DEFAULT 0,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE act_archive_recovery_items (
      id uuid PRIMARY KEY,
      run_id uuid NOT NULL,
      source_record_id uuid NOT NULL,
      source_version_id uuid NOT NULL,
      stream_type text NOT NULL,
      priority int NOT NULL,
      state text NOT NULL,
      target_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_error_code text,
      retry_after timestamptz,
      lease_owner text,
      lease_token uuid,
      lease_expires_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
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
    CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE contacts (id uuid PRIMARY KEY, first_name text NOT NULL, last_name text NOT NULL);
    CREATE TABLE bookings (id uuid PRIMARY KEY, name text NOT NULL);

    INSERT INTO act_source_records
      (id, source_database_key, stream_type, act_record_id, latest_version_id)
    VALUES ('${SOURCE_ID}', 'archive-db', 'history', 'history-1', '${VERSION_ID}');
    INSERT INTO act_source_record_versions (id, source_record_id, raw_snapshot)
    VALUES ('${VERSION_ID}', '${SOURCE_ID}', '{"regarding":"E-mail sent","details":"Proposal sent"}');
    INSERT INTO act_archive_recovery_runs
      (id, source_database_key, requested_by, request_key, state, candidate_count)
    VALUES ('${RUN_ID}', 'archive-db', 'owner', 'request-1', 'complete', 1);
    INSERT INTO act_archive_recovery_items
      (id, run_id, source_record_id, source_version_id, stream_type, priority, state, target_summary, completed_at)
    VALUES (
      '${ITEM_ID}', '${RUN_ID}', '${SOURCE_ID}', '${VERSION_ID}', 'history', 80,
      'needs_review', '{"reason":"timeline_parent_unresolved"}', now()
    );
    INSERT INTO organizations (id, name) VALUES ('${TARGET_ID}', '16th Street Fair (Denver) CO');
  `);
});

afterEach(async () => {
  await client.close();
});

function service() {
  return new ActRecoveryReviewService(database as never, {
    createOrGetRun: vi.fn(),
  } as never);
}

describe("ActRecoveryReviewService", () => {
  it("records an explicit timeline parent decision and safely requeues the frozen source version", async () => {
    await service().assign({
      sourceRecordId: SOURCE_ID,
      sourceVersionId: VERSION_ID,
      targetEntityType: "organization",
      targetEntityId: TARGET_ID,
      decidedBy: "owner",
    });

    const decisions = await client.query<{
      decision: string;
      target_entity_type: string;
      target_entity_id: string;
    }>("SELECT decision, target_entity_type, target_entity_id FROM act_archive_recovery_decisions");
    expect(decisions.rows).toEqual([{
      decision: "assign_parent",
      target_entity_type: "organization",
      target_entity_id: TARGET_ID,
    }]);
    const item = await client.query<{ state: string; completed_at: Date | null }>(
      `SELECT state, completed_at FROM act_archive_recovery_items WHERE id = '${ITEM_ID}'`,
    );
    expect(item.rows[0]).toMatchObject({ state: "pending", completed_at: null });
    const run = await client.query<{ state: string }>(`SELECT state FROM act_archive_recovery_runs WHERE id = '${RUN_ID}'`);
    expect(run.rows).toEqual([{ state: "running" }]);
  });

  it("rejects stale source-version proof before changing review state", async () => {
    await expect(service().assign({
      sourceRecordId: SOURCE_ID,
      sourceVersionId: STALE_VERSION_ID,
      targetEntityType: "organization",
      targetEntityId: TARGET_ID,
      decidedBy: "owner",
    })).rejects.toMatchObject({ status: 409, code: "act_recovery_source_version_stale" });

    const state = await client.query<{ state: string }>(
      `SELECT state FROM act_archive_recovery_items WHERE id = '${ITEM_ID}'`,
    );
    expect(state.rows).toEqual([{ state: "needs_review" }]);
  });

  it("makes an explicit drop terminal without deleting the permanent archive row", async () => {
    await service().drop({
      sourceRecordId: SOURCE_ID,
      sourceVersionId: VERSION_ID,
      decidedBy: "owner",
    });

    const item = await client.query<{ state: string }>(
      `SELECT state FROM act_archive_recovery_items WHERE id = '${ITEM_ID}'`,
    );
    expect(item.rows).toEqual([{ state: "dropped_unusable" }]);
    const source = await client.query<{ id: string }>(
      `SELECT id FROM act_source_records WHERE id = '${SOURCE_ID}'`,
    );
    expect(source.rows).toEqual([{ id: SOURCE_ID }]);
  });
});
