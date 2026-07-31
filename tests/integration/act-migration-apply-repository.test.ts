import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzleActMigrationApplyRepository,
} from "@/features/act-migration/apply-repository";
import { buildMigrationApplyManifest } from "@/features/act-migration/apply-manifest";
import type { MigrationApplyProposal } from "@/features/act-migration/apply-types";
import { proposalSnapshotDigest } from "@/features/act-migration/reconciliation";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const runId = "11111111-1111-4111-8111-111111111111";
const sourceDigest = "source-digest";

function testSchemaName() {
  return `act_apply_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function proposal(input: Partial<MigrationApplyProposal> & { proposalKey: string }) {
  return {
    state: "new",
    reviewState: "decided",
    targetEntityType: "organization",
    sourceRecordKeys: [input.proposalKey],
    candidateLocalIds: [],
    proposedLocalId: null,
    proposedPrimarySourceId: null,
    issueCode: null,
    dependencyProposalKeys: [],
    matchReason: "fixture",
    displaySnapshot: {},
    decision: "approve_proposed",
    chosenLocalEntityId: null,
    primarySourceId: null,
    ...input,
  } as MigrationApplyProposal;
}

describe("DrizzleActMigrationApplyRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let database: ReturnType<typeof drizzle<typeof crmSchema>>;
  let repository: DrizzleActMigrationApplyRepository;

  async function storePreview(proposals: readonly MigrationApplyProposal[]) {
    const digest = proposalSnapshotDigest(proposals);
    await database.update(crmSchema.actMigrationRuns)
      .set({ status: "previewed", sourceDigest, proposalDigest: digest, summary: { complete: true } })
      .where(eq(crmSchema.actMigrationRuns.id, runId));
    await database.insert(crmSchema.actMigrationProposals).values(proposals.map((row) => ({
      runId,
      proposalKey: row.proposalKey,
      state: row.state,
      reviewState: row.reviewState,
      targetEntityType: row.targetEntityType,
      sourceRecordKeys: [...row.sourceRecordKeys],
      candidateLocalIds: [...row.candidateLocalIds],
      proposedLocalId: row.proposedLocalId,
      proposedPrimarySourceId: row.proposedPrimarySourceId,
      duplicateGroupKey: row.duplicateGroupKey ?? null,
      duplicateSourceIds: [...(row.duplicateSourceIds ?? [])],
      issueCode: row.issueCode,
      dependencyProposalKeys: [...row.dependencyProposalKeys],
      matchReason: row.matchReason,
      displaySnapshot: row.displaySnapshot,
      decision: row.decision,
      chosenLocalEntityId: row.chosenLocalEntityId,
      primarySourceId: row.primarySourceId,
    })));
    return buildMigrationApplyManifest({
      sourceDigest,
      previewSourceDigest: sourceDigest,
      previewProposalDigest: digest,
      proposals,
      stableLinks: [],
    });
  }

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    const setupSql = postgres(databaseUrl, { max: 1, connection: { search_path: `${schemaName},public` } });
    try {
      await setupSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      const journal = JSON.parse(await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
          await setupSql.unsafe(statement);
        }
      }
    } finally {
      await setupSql.end({ timeout: 5 });
    }
    sql = postgres(databaseUrl, { max: 4, connection: { search_path: `${schemaName},public` } });
    database = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleActMigrationApplyRepository(database);
    await database.insert(crmSchema.actMigrationRuns).values({
      id: runId,
      requestKey: "22222222-2222-4222-8222-222222222222",
      sourceDatabaseKey: "disposable-test-copy",
      requestedBy: "apply-test",
      status: "snapshot_complete",
      sourceDigest,
    });
  });

  afterEach(async () => {
    if (!sql) return;
    try { await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); }
    finally { await sql.end({ timeout: 5 }); sql = undefined; }
  });

  postgresTest("replays a request key, freezes decisions, and rejects a conflicting run", async () => {
    const manifest = await storePreview([proposal({ proposalKey: "organization:one" })]);
    const input = { requestKey: "33333333-3333-4333-8333-333333333333", runId, requestedBy: "owner", manifest, now: new Date("2026-07-31T12:00:00Z") };
    const first = await repository.createBatchIfAbsent(input);
    await expect(repository.createBatchIfAbsent(input)).resolves.toMatchObject({ id: first.id, created: false });
    await expect(repository.createBatchIfAbsent({ ...input, runId: "44444444-4444-4444-8444-444444444444" })).rejects.toThrow("request key");
    expect(await sql!.unsafe(`SELECT status FROM act_migration_runs WHERE id = '${runId}'`)).toEqual([{ status: "applying" }]);
    expect(await sql!.unsafe(`SELECT proposal_key FROM act_migration_apply_operations`)).toEqual([{ proposal_key: "organization:one" }]);
  });

  postgresTest("retains duplicate-place provenance when rebuilding the reviewed manifest", async () => {
    const manifest = await storePreview([
      proposal({
        proposalKey: "organization:company:ACT-1",
        sourceRecordKeys: ["company:ACT-1", "company:ACT-2"],
        duplicateGroupKey: '["example place","1 main denver co"]',
        duplicateSourceIds: ["ACT-1", "ACT-2"],
      }),
    ]);

    await expect(repository.createBatchIfAbsent({
      requestKey: "33333333-3333-4333-8333-333333333333",
      runId,
      requestedBy: "owner",
      manifest,
      now: new Date("2026-07-31T12:00:00Z"),
    })).resolves.toMatchObject({ created: true });
  });

  postgresTest("leases distinct dependency-ready operations, blocks unresolved children, and releases expired leases", async () => {
    const manifest = await storePreview([
      proposal({ proposalKey: "organization:parent" }),
      proposal({ proposalKey: "contact:child", targetEntityType: "contact", dependencyProposalKeys: ["organization:parent"] }),
      proposal({ proposalKey: "organization:peer" }),
    ]);
    const batch = await repository.createBatchIfAbsent({ requestKey: "33333333-3333-4333-8333-333333333333", runId, requestedBy: "owner", manifest, now: new Date("2026-07-31T12:00:00Z") });
    const now = new Date("2026-07-31T12:01:00Z");
    const [first, second] = await Promise.all([
      repository.claimNextOperation(batch.id, "worker-a", now),
      repository.claimNextOperation(batch.id, "worker-b", now),
    ]);
    expect(first?.proposalKey).not.toBe(second?.proposalKey);
    expect([first?.proposalKey, second?.proposalKey].sort()).toEqual(["organization:parent", "organization:peer"]);
    expect(await repository.claimNextOperation(batch.id, "worker-c", now)).toBeNull();
    expect(await sql!.unsafe(`SELECT proposal_key, status FROM act_migration_apply_operations ORDER BY proposal_key`)).toContainEqual({ proposal_key: "contact:child", status: "blocked" });
    await repository.releaseExpiredLeases(batch.id, new Date("2026-07-31T12:04:00Z"));
    expect(await repository.claimNextOperation(batch.id, "worker-d", new Date("2026-07-31T12:04:00Z"))).toMatchObject({ status: "leased" });
  });

  postgresTest("requeues retryable failures, retains deterministic failures, and updates batch counts", async () => {
    const manifest = await storePreview([proposal({ proposalKey: "organization:one" })]);
    const batch = await repository.createBatchIfAbsent({ requestKey: "33333333-3333-4333-8333-333333333333", runId, requestedBy: "owner", manifest, now: new Date("2026-07-31T12:00:00Z") });
    const first = await repository.claimNextOperation(batch.id, "worker-a", new Date("2026-07-31T12:01:00Z"));
    await repository.failOperation({ operationId: first!.id, leaseOwner: "worker-a", errorCode: "raw unsafe error", retryable: true, now: new Date("2026-07-31T12:01:01Z") });
    const retry = await repository.claimNextOperation(batch.id, "worker-b", new Date("2026-07-31T12:01:02Z"));
    await repository.failOperation({ operationId: retry!.id, leaseOwner: "worker-b", errorCode: "dependency_missing", retryable: false, now: new Date("2026-07-31T12:01:03Z") });
    const [operation] = await sql!.unsafe(`SELECT status, retryable, error_code FROM act_migration_apply_operations`);
    const [storedBatch] = await sql!.unsafe(`SELECT status, summary, last_error_code FROM act_migration_apply_batches`);
    expect(operation).toEqual({ status: "failed", retryable: false, error_code: "dependency_missing" });
    expect(storedBatch).toMatchObject({ status: "failed", last_error_code: "dependency_missing", summary: expect.objectContaining({ failed: 1 }) });
  });
});
