import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzleActMigrationSnapshotRepository,
} from "@/features/act-migration/snapshot-repository";
import type { StagedSourceItem } from "@/features/act-migration/source-parser";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const postgresTest = databaseUrl ? it : it.skip;

function testSchemaName() {
  return `act_snapshot_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(
    path.join(migrationDirectory, fileName),
    "utf8",
  );
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function staged(
  streamType: StagedSourceItem["streamType"],
  sourceId: string,
  rawSnapshot: Record<string, unknown> = { id: sourceId },
): StagedSourceItem {
  return {
    streamType,
    sourceKey: `${streamType}:${sourceId}`,
    sourceId,
    targetSourceId: null,
    rawSnapshot,
    normalizedSnapshot: { displayName: sourceId },
    fingerprint: `fingerprint:${streamType}:${sourceId}`,
    errorCode: null,
    errorFields: [],
  };
}

describe("DrizzleActMigrationSnapshotRepository (PostgreSQL)", () => {
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleActMigrationSnapshotRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    const setupSql = postgres(databaseUrl, { max: 1 });
    await setupSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await setupSql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(
      await readFile(
        path.join(migrationDirectory, "meta", "_journal.json"),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(
        `${entry.tag}.sql`,
        schemaName,
      )) {
        await setupSql.unsafe(statement);
      }
    }
    await setupSql.end({ timeout: 5 });
    sql = postgres(databaseUrl, {
      max: 4,
      connection: { search_path: `${schemaName},public` },
    });
    repository = new DrizzleActMigrationSnapshotRepository(
      drizzle({ client: sql, schema: crmSchema }),
    );
  });

  afterEach(async () => {
    if (!sql) return;
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await sql.end({ timeout: 5 });
      sql = undefined;
    }
  });

  async function createRun() {
    return repository.createRun({
      requestKey: randomUUID(),
      sourceDatabaseKey: "act-production-copy",
      requestedBy: "snapshot-test",
    });
  }

  postgresTest(
    "reuses a request key and creates the four root checkpoints in dependency order",
    async () => {
      const input = {
        requestKey: randomUUID(),
        sourceDatabaseKey: "act-production-copy",
        requestedBy: "snapshot-test",
      };

      const first = await repository.createRun(input);
      const second = await repository.createRun(input);

      expect(second).toEqual(first);
      expect(await sql!.unsafe(`
        SELECT stream_type, partition_key
        FROM act_migration_checkpoints
        WHERE run_id = '${first.id}'
        ORDER BY CASE stream_type
          WHEN 'company' THEN 0
          WHEN 'contact' THEN 1
          WHEN 'opportunity' THEN 2
          WHEN 'group' THEN 3
          ELSE 4
        END
      `)).toEqual([
        { stream_type: "company", partition_key: "root" },
        { stream_type: "contact", partition_key: "root" },
        { stream_type: "opportunity", partition_key: "root" },
        { stream_type: "group", partition_key: "root" },
      ]);
    },
  );

  postgresTest(
    "leases distinct checkpoints to concurrent callers and reclaims an expired lease",
    async () => {
      const run = await createRun();
      const now = new Date("2026-07-30T15:00:00.000Z");

      const [first, second] = await Promise.all([
        repository.claimNextCheckpoint(run.id, "worker-a", now),
        repository.claimNextCheckpoint(run.id, "worker-b", now),
      ]);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.id).not.toBe(second!.id);
      expect(new Set([first!.streamType, second!.streamType])).toEqual(
        new Set(["company", "contact"]),
      );

      const reclaimed = await repository.claimNextCheckpoint(
        run.id,
        "worker-c",
        new Date("2026-07-30T15:05:01.000Z"),
      );
      expect(reclaimed?.id).toBe(first?.streamType === "company"
        ? first.id
        : second?.id);
      expect(await sql!.unsafe(`
        SELECT lease_owner, lease_expires_at
        FROM act_migration_checkpoints
        WHERE id = '${reclaimed!.id}'
      `)).toEqual([{
        lease_owner: "worker-c",
        lease_expires_at: new Date("2026-07-30T15:10:01.000Z"),
      }]);
    },
  );

  postgresTest(
    "atomically stores a page, advances the guarded checkpoint, and preserves the first source snapshot on replay",
    async () => {
      const run = await createRun();
      const now = new Date("2026-07-30T15:00:00.000Z");
      const checkpoint = await repository.claimNextCheckpoint(
        run.id,
        "worker-a",
        now,
      );

      await repository.storePage({
        checkpointId: checkpoint!.id,
        leaseOwner: "worker-a",
        expectedSkip: 0,
        records: [staged("company", "company-1", { id: "company-1", name: "First" })],
        nextSkip: 1,
        queryMode: "projected",
        now,
      });
      const replayLease = await repository.claimNextCheckpoint(
        run.id,
        "worker-b",
        new Date("2026-07-30T15:01:00.000Z"),
      );
      expect(replayLease?.id).toBe(checkpoint!.id);
      await repository.storePage({
        checkpointId: checkpoint!.id,
        leaseOwner: "worker-b",
        expectedSkip: 1,
        records: [staged("company", "company-1", { id: "company-1", name: "Replay" })],
        nextSkip: 2,
        queryMode: "plain",
        now: new Date("2026-07-30T15:01:00.000Z"),
      });

      expect(await sql!.unsafe(`
        SELECT source_key, raw_snapshot
        FROM act_migration_records
        WHERE run_id = '${run.id}'
      `)).toEqual([{
        source_key: "company:company-1",
        raw_snapshot: { id: "company-1", name: "First" },
      }]);
      expect(await sql!.unsafe(`
        SELECT next_skip, query_mode, status, records_staged, lease_owner
        FROM act_migration_checkpoints
        WHERE id = '${checkpoint!.id}'
      `)).toEqual([{
        next_skip: 2,
        query_mode: "plain",
        status: "pending",
        records_staged: 1,
        lease_owner: null,
      }]);
    },
  );

  postgresTest(
    "rolls back page records when the lease and expected skip guard does not match",
    async () => {
      const run = await createRun();
      const checkpoint = await repository.claimNextCheckpoint(
        run.id,
        "worker-a",
        new Date("2026-07-30T15:00:00.000Z"),
      );

      await expect(repository.storePage({
        checkpointId: checkpoint!.id,
        leaseOwner: "worker-a",
        expectedSkip: 1,
        records: [staged("company", "must-not-commit")],
        nextSkip: 2,
        queryMode: "projected",
        now: new Date("2026-07-30T15:00:01.000Z"),
      })).rejects.toThrow("checkpoint lease");

      expect(await sql!.unsafe(`
        SELECT count(*) AS value FROM act_migration_records
        WHERE run_id = '${run.id}'
      `)).toEqual([{ value: "0" }]);
    },
  );

  postgresTest("completes a checkpoint when an empty page is stored", async () => {
    const run = await createRun();
    const checkpoint = await repository.claimNextCheckpoint(
      run.id,
      "worker-a",
      new Date("2026-07-30T15:00:00.000Z"),
    );

    await repository.storePage({
      checkpointId: checkpoint!.id,
      leaseOwner: "worker-a",
      expectedSkip: 0,
      records: [],
      nextSkip: null,
      queryMode: "projected",
      now: new Date("2026-07-30T15:00:01.000Z"),
    });

    expect(await sql!.unsafe(`
      SELECT status, completed_at, lease_owner
      FROM act_migration_checkpoints WHERE id = '${checkpoint!.id}'
    `)).toEqual([{
      status: "complete",
      completed_at: new Date("2026-07-30T15:00:01.000Z"),
      lease_owner: null,
    }]);
  });

  postgresTest(
    "stores sanitized failure fields and persists retryability independently from retry time",
    async () => {
      const run = await createRun();
      const checkpoint = await repository.claimNextCheckpoint(
        run.id,
        "worker-a",
        new Date("2026-07-30T15:00:00.000Z"),
      );
      const retryAfter = new Date("2026-07-30T16:00:00.000Z");

      await repository.failCheckpoint({
        checkpointId: checkpoint!.id,
        leaseOwner: "worker-a",
        errorCode: "permission_denied",
        retryable: false,
        retryAfter,
        now: new Date("2026-07-30T15:00:01.000Z"),
      });

      expect(await sql!.unsafe(`
        SELECT status, error_code, retryable, retry_after, lease_owner
        FROM act_migration_checkpoints WHERE id = '${checkpoint!.id}'
      `)).toEqual([{
        status: "failed",
        error_code: "permission_denied",
        retryable: false,
        retry_after: retryAfter,
        lease_owner: null,
      }]);
    },
  );

  postgresTest(
    "creates relationship checkpoints once, after every root is complete, with semantic parent ids",
    async () => {
      const run = await createRun();
      await repository.enqueueRelationshipCheckpoints(run.id);
      expect(await sql!.unsafe(`
        SELECT count(*) AS value FROM act_migration_checkpoints
        WHERE run_id = '${run.id}' AND partition_key <> 'root'
      `)).toEqual([{ value: "0" }]);

      const rootRecords = [
        staged("company", "company-1"),
        staged("contact", "contact-1"),
        staged("opportunity", "opportunity-1"),
        staged("group", "group-1"),
      ];
      for (let index = 0; index < rootRecords.length; index += 1) {
        const checkpoint = await repository.claimNextCheckpoint(
          run.id,
          `worker-${index}`,
          new Date(`2026-07-30T15:0${index}:00.000Z`),
        );
        await repository.storePage({
          checkpointId: checkpoint!.id,
          leaseOwner: `worker-${index}`,
          expectedSkip: 0,
          records: [rootRecords[index]!],
          nextSkip: null,
          queryMode: "projected",
          now: new Date(`2026-07-30T15:0${index}:01.000Z`),
        });
        await repository.enqueueRelationshipCheckpoints(run.id);
      }
      await repository.enqueueRelationshipCheckpoints(run.id);

      expect(await sql!.unsafe(`
        SELECT stream_type, partition_key, parent_source_id
        FROM act_migration_checkpoints
        WHERE run_id = '${run.id}' AND partition_key <> 'root'
        ORDER BY stream_type, partition_key
      `)).toEqual([
        {
          stream_type: "company_contact",
          partition_key: "contact:contact-1",
          parent_source_id: "contact-1",
        },
        {
          stream_type: "group_contact",
          partition_key: "group:group-1:contacts",
          parent_source_id: "group-1",
        },
        {
          stream_type: "opportunity_company",
          partition_key: "opportunity:opportunity-1:companies",
          parent_source_id: "opportunity-1",
        },
        {
          stream_type: "opportunity_contact",
          partition_key: "opportunity:opportunity-1:contacts",
          parent_source_id: "opportunity-1",
        },
      ]);
    },
  );

  postgresTest(
    "rejects finalization while checkpoints are pending or retryable-failed",
    async () => {
      const pendingRun = await createRun();
      await expect(
        repository.finalizeSourceSnapshot(pendingRun.id),
      ).rejects.toThrow("incomplete");

      const failedRun = await createRun();
      const checkpoint = await repository.claimNextCheckpoint(
        failedRun.id,
        "worker-a",
        new Date("2026-07-30T15:00:00.000Z"),
      );
      await repository.failCheckpoint({
        checkpointId: checkpoint!.id,
        leaseOwner: "worker-a",
        errorCode: "unavailable",
        retryable: true,
        retryAfter: new Date("2026-07-30T15:01:00.000Z"),
        now: new Date("2026-07-30T15:00:01.000Z"),
      });

      await expect(
        repository.finalizeSourceSnapshot(failedRun.id),
      ).rejects.toThrow("incomplete");
    },
  );

  postgresTest(
    "finalizes an empty completed checkpoint set with a stable digest",
    async () => {
      const run = await createRun();
      for (let index = 0; index < 4; index += 1) {
        const checkpoint = await repository.claimNextCheckpoint(
          run.id,
          `worker-${index}`,
          new Date(`2026-07-30T15:0${index}:00.000Z`),
        );
        await repository.storePage({
          checkpointId: checkpoint!.id,
          leaseOwner: `worker-${index}`,
          expectedSkip: 0,
          records: [],
          nextSkip: null,
          queryMode: "projected",
          now: new Date(`2026-07-30T15:0${index}:01.000Z`),
        });
      }
      await repository.enqueueRelationshipCheckpoints(run.id);

      const first = await repository.finalizeSourceSnapshot(run.id);
      const second = await repository.finalizeSourceSnapshot(run.id);

      expect(first.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(second).toEqual(first);
      expect(first.records).toEqual([]);
      expect(first.checkpoints.map(({ streamType }) => streamType)).toEqual([
        "company",
        "contact",
        "opportunity",
        "group",
      ]);
      expect((await repository.getProgress(run.id)).status)
        .toBe("snapshot_complete");
    },
  );
});
