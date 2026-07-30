import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzleActMigrationPreviewRepository,
} from "@/features/act-migration/preview-repository";
import { ActMigrationPreviewService } from "@/features/act-migration/preview-service";
import { proposalSnapshotDigest } from "@/features/act-migration/reconciliation";
import type { ActMigrationProposal } from "@/features/act-migration/migration-types";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `act_preview_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const runId = "11111111-1111-4111-8111-111111111111";
const proposal: ActMigrationProposal = {
  proposalKey: "organization:company-1",
  state: "new",
  reviewState: "pending",
  targetEntityType: "organization",
  sourceRecordKeys: ["company:company-1"],
  candidateLocalIds: [],
  proposedLocalId: null,
  proposedPrimarySourceId: null,
  issueCode: null,
  dependencyProposalKeys: [],
  matchReason: "new source record",
  displaySnapshot: { name: "Company One" },
};

function report(proposals: readonly ActMigrationProposal[]) {
  return {
    sourceCounts: { company: 1, contact: 0, opportunity: 0, group: 0 },
    relationshipCounts: {
      company_contact: 0,
      opportunity_company: 0,
      opportunity_contact: 0,
      group_contact: 0,
    },
    previewCounts: {
      new: 1,
      matched_unchanged: 0,
      change: 0,
      new_relationship: 0,
      possible_duplicate: 0,
      needs_review: 0,
      ignored: 0,
      error: 0,
    },
    placesWithoutPeople: 1,
    multiPlacePeople: 0,
    opportunitiesWithoutPlace: 0,
    opportunitiesWithoutPerson: 0,
    duplicateSourceIdConflicts: 0,
    incompleteCheckpoints: 0,
    failedCheckpoints: 0,
    sourceDigest: "source-digest",
    proposalDigest: proposalSnapshotDigest(proposals),
    complete: true,
  } as const;
}

describe("DrizzleActMigrationPreviewRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleActMigrationPreviewRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(await readFile(
      path.join(migrationDirectory, "meta", "_journal.json"), "utf8",
    )) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
        await sql.unsafe(statement);
      }
    }
    const database = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleActMigrationPreviewRepository(database);
    await database.insert(crmSchema.actMigrationRuns).values({
      id: runId,
      requestKey: "22222222-2222-4222-8222-222222222222",
      sourceDatabaseKey: "disposable-test-copy",
      requestedBy: "preview-test",
      status: "snapshot_complete",
      sourceDigest: "source-digest",
    });
    await database.insert(crmSchema.actMigrationRecords).values({
      runId,
      streamType: "company",
      sourceKey: "company:company-1",
      sourceId: "company-1",
      targetSourceId: null,
      rawSnapshot: { id: "company-1" },
      normalizedSnapshot: { name: "Company One" },
      fingerprint: "company-fingerprint",
    });
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

  postgresTest("stores immutable preview evidence once and reloads it in target order", async () => {
    const proposals = [proposal];
    const reconciliation = report(proposals);

    await repository.storeProposalsIfAbsent({
      runId,
      sourceDigest: reconciliation.sourceDigest,
      proposalDigest: reconciliation.proposalDigest,
      proposals,
      report: reconciliation,
    });
    const first = await repository.getPreview(runId, { page: 1, pageSize: 1 });
    await repository.storeProposalsIfAbsent({
      runId,
      sourceDigest: reconciliation.sourceDigest,
      proposalDigest: reconciliation.proposalDigest,
      proposals,
      report: reconciliation,
    });
    const second = await repository.getPreview(runId, { page: 1, pageSize: 1 });

    expect(first.rows).toEqual(second.rows);
    expect(first.rows).toMatchObject([proposal]);
    expect(first.report).toEqual(reconciliation);
    expect(first.total).toBe(1);
  });
});

describe("ActMigrationPreviewService", () => {
  it("returns an existing immutable preview before reading the snapshot or local candidates", async () => {
    const reconciliation = report([proposal]);
    const stored = {
      runId,
      rows: [],
      report: reconciliation,
      page: 1,
      pageSize: 50,
      total: 0,
    };
    const service = new ActMigrationPreviewService(
      {
        finalizeSourceSnapshot: async () => {
          throw new Error("snapshot should not be read");
        },
      } as never,
      {
        loadCandidateSnapshot: async () => {
          throw new Error("local candidates should not be read");
        },
      },
      {
        getPreviewIfStored: async () => stored,
        getPreview: async () => {
          throw new Error("stored preview should be returned directly");
        },
        storeProposalsIfAbsent: async () => {
          throw new Error("stored preview should not be written");
        },
        saveDecision: async () => undefined,
      },
    );

    await expect(service.finalizePreview(runId)).resolves.toEqual(stored);
  });
});
