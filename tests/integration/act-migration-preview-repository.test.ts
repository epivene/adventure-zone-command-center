import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzleActMigrationPreviewRepository,
} from "@/features/act-migration/preview-repository";
import { ActMigrationPreviewService } from "@/features/act-migration/preview-service";
import { proposalSnapshotDigest } from "@/features/act-migration/reconciliation";
import { ActMigrationRunNotFoundError } from "@/features/act-migration/snapshot-repository";
import type { ActMigrationProposal } from "@/features/act-migration/migration-types";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const runId = "11111111-1111-4111-8111-111111111111";
const localA = "22222222-2222-4222-8222-222222222222";
const localB = "33333333-3333-4333-8333-333333333333";

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

function proposal(input: Partial<ActMigrationProposal> & {
  proposalKey: string;
  sourceRecordKeys: readonly string[];
}): ActMigrationProposal {
  return {
    state: "new",
    reviewState: "pending",
    targetEntityType: "organization",
    candidateLocalIds: [],
    proposedLocalId: null,
    proposedPrimarySourceId: null,
    issueCode: null,
    dependencyProposalKeys: [],
    matchReason: "fixture match",
    displaySnapshot: { label: input.proposalKey, stable: true },
    ...input,
  };
}

const baseProposal = () => proposal({
  proposalKey: "organization:company-1",
  sourceRecordKeys: ["company:company-1"],
});

function report(proposals: readonly ActMigrationProposal[], overrides = {}) {
  return {
    sourceCounts: { company: 1, contact: 0, opportunity: 0, group: 0 },
    relationshipCounts: {
      company_contact: 0,
      opportunity_company: 0,
      opportunity_contact: 0,
      group_contact: 0,
    },
    previewCounts: {
      new: proposals.filter(({ state }) => state === "new").length,
      matched_unchanged: 0,
      change: proposals.filter(({ state }) => state === "change").length,
      new_relationship: proposals.filter(({ state }) => state === "new_relationship").length,
      possible_duplicate: proposals.filter(({ state }) => state === "possible_duplicate").length,
      needs_review: proposals.filter(({ state }) => state === "needs_review").length,
      ignored: 0,
      error: 0,
    },
    placesWithoutPeople: 0,
    multiPlacePeople: 0,
    opportunitiesWithoutPlace: 0,
    opportunitiesWithoutPerson: 0,
    duplicateSourceIdConflicts: 0,
    incompleteCheckpoints: 0,
    failedCheckpoints: 0,
    sourceDigest: "source-digest",
    proposalDigest: proposalSnapshotDigest(proposals),
    complete: true,
    ...overrides,
  } as const;
}

function sourceId(sourceKey: string) {
  return sourceKey.split(":").slice(1).join(":");
}

function streamType(sourceKey: string) {
  return sourceKey.split(":")[0] ?? "company";
}

async function waitForDatabaseLock(
  observer: postgres.Sql,
  backendPid: number,
  options: {
    expectedLockType?: "advisory";
    operationSettled: () => boolean;
    timeoutMs?: number;
  },
) {
  const {
    expectedLockType,
    operationSettled,
    timeoutMs = 20_000,
  } = options;
  const lockTypeFilter = expectedLockType
    ? `AND locktype = '${expectedLockType}'`
    : "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (operationSettled()) {
      throw new Error("Database operation settled before its lock wait was observed.");
    }
    const [activity] = await observer.unsafe(`
      SELECT
        wait_event_type,
        EXISTS (
          SELECT 1
          FROM pg_locks
          WHERE pid = ${backendPid}
            AND NOT granted
            ${lockTypeFilter}
        ) AS waiting_on_expected_lock
      FROM pg_stat_activity
      WHERE pid = ${backendPid}
    `);
    if (
      activity?.wait_event_type === "Lock" &&
      activity.waiting_on_expected_lock
    ) {
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(25, remainingMs))
      );
    }
  }
  throw new Error(
    expectedLockType
      ? `Expected the database session to wait on an ${expectedLockType} lock within ${timeoutMs}ms.`
      : `Expected the database session to wait on a lock within ${timeoutMs}ms.`,
  );
}

function postgresTimestamp(value: unknown) {
  const timestamp = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : new Date(Number.NaN);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Expected a valid PostgreSQL timestamp.");
  }
  return timestamp;
}

function errorCauseMessages(error: unknown) {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(current.message);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return messages;
}

describe("preview decision run lookup", () => {
  it("distinguishes a missing run from a stored run in the wrong status", async () => {
    const repositoryWithRunRows = (runRows: unknown[]) => {
      const query = {
        from() {
          return this;
        },
        where() {
          return this;
        },
        limit() {
          return this;
        },
        for() {
          return Promise.resolve(runRows);
        },
      };
      const database = {
        transaction<T>(operation: (transaction: {
          select(): typeof query;
        }) => Promise<T>) {
          return operation({ select: () => query });
        },
      };
      return new DrizzleActMigrationPreviewRepository(database as never);
    };
    const input = {
      runId,
      proposalKey: "contact:missing-run",
      decision: "ignore" as const,
      ignoreReason: "reviewed",
      decidedBy: "owner",
    };

    await expect(
      repositoryWithRunRows([]).saveDecision(input),
    ).rejects.toBeInstanceOf(ActMigrationRunNotFoundError);
    await expect(
      repositoryWithRunRows([{
        id: runId,
        status: "snapshot_complete",
      }]).saveDecision(input),
    ).rejects.toThrow("not ready");
  });
});

describe("DrizzleActMigrationPreviewRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let database: ReturnType<typeof drizzle<typeof crmSchema>>;
  let repository: DrizzleActMigrationPreviewRepository;

  async function insertRecord(sourceKey: string, reviewState = "not_required") {
    await database.insert(crmSchema.actMigrationRecords).values({
      runId,
      streamType: streamType(sourceKey),
      sourceKey,
      sourceId: sourceId(sourceKey),
      targetSourceId: null,
      rawSnapshot: { id: sourceId(sourceKey), confidential: "not-audit" },
      normalizedSnapshot: { label: sourceKey },
      fingerprint: `fingerprint:${sourceKey}`,
      reviewState,
    });
  }

  async function ensureProposalRecords(proposals: readonly ActMigrationProposal[]) {
    const [known] = await sql!.unsafe<{ values: string }[]>(`
      SELECT json_agg(source_key ORDER BY source_key)::text AS values
      FROM act_migration_records WHERE run_id = '${runId}'
    `);
    const keys = new Set<string>(JSON.parse(known?.values ?? "[]"));
    for (const key of proposals.flatMap(({ sourceRecordKeys }) => sourceRecordKeys)) {
      if (!keys.has(key)) await insertRecord(key);
    }
  }

  async function store(
    proposals: readonly ActMigrationProposal[],
    options: {
      sourceDigest?: string;
      proposalDigest?: string;
      report?: ReturnType<typeof report>;
    } = {},
  ) {
    await ensureProposalRecords(proposals);
    const reconciliation = options.report ?? report(proposals);
    return repository.storeProposalsIfAbsent({
      runId,
      sourceDigest: options.sourceDigest ?? reconciliation.sourceDigest,
      proposalDigest: options.proposalDigest ?? reconciliation.proposalDigest,
      proposals,
      report: reconciliation,
    });
  }

  function storeDirect(
    proposals: readonly ActMigrationProposal[],
    options: {
      sourceDigest?: string;
      proposalDigest?: string;
      report?: ReturnType<typeof report>;
    } = {},
  ) {
    const reconciliation = options.report ?? report(proposals);
    return repository.storeProposalsIfAbsent({
      runId,
      sourceDigest: options.sourceDigest ?? reconciliation.sourceDigest,
      proposalDigest: options.proposalDigest ?? reconciliation.proposalDigest,
      proposals,
      report: reconciliation,
    });
  }

  async function proposalRows() {
    return sql!.unsafe(`
      SELECT proposal_key, state, review_state, target_entity_type,
        source_record_keys, candidate_local_ids, proposed_local_id,
        proposed_primary_source_id, issue_code, dependency_proposal_keys,
        match_reason, display_snapshot, decision, decision_reason,
        chosen_local_entity_id, primary_source_id, decided_by, decided_at,
        created_at, updated_at
      FROM act_migration_proposals WHERE run_id = '${runId}'
      ORDER BY proposal_key
    `);
  }

  async function auditRows() {
    return sql!.unsafe(`
      SELECT entity_type, action, before, after FROM audit_entries
      ORDER BY created_at, id
    `);
  }

  async function crmSentinels() {
    return Promise.all([
      sql!.unsafe(`SELECT * FROM organizations ORDER BY id`),
      sql!.unsafe(`SELECT * FROM contacts ORDER BY id`),
      sql!.unsafe(`SELECT * FROM bookings ORDER BY id`),
      sql!.unsafe(`SELECT * FROM organization_contacts ORDER BY id`),
      sql!.unsafe(`SELECT * FROM booking_contacts ORDER BY id`),
      sql!.unsafe(`SELECT * FROM act_external_links ORDER BY id`),
    ]);
  }

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    const setupSql = postgres(databaseUrl, { max: 1 });
    try {
      await setupSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await setupSql.unsafe(`SET search_path TO "${schemaName}", public`);
      const journal = JSON.parse(await readFile(
        path.join(migrationDirectory, "meta", "_journal.json"), "utf8",
      )) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        for (
          const statement of await migrationStatements(
            `${entry.tag}.sql`,
            schemaName,
          )
        ) {
          await setupSql.unsafe(statement);
        }
      }
    } finally {
      await setupSql.end({ timeout: 5 });
    }
    sql = postgres(databaseUrl, {
      max: 4,
      connection: { search_path: `${schemaName},public` },
    });
    database = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleActMigrationPreviewRepository(database);
    await database.insert(crmSchema.actMigrationRuns).values({
      id: runId,
      requestKey: "44444444-4444-4444-8444-444444444444",
      sourceDatabaseKey: "disposable-test-copy",
      requestedBy: "preview-test",
      status: "snapshot_complete",
      sourceDigest: "source-digest",
    });
    await insertRecord("company:company-1");
    await database.insert(crmSchema.organizations).values([
      { id: localA, name: "Local Place A" },
      { id: localB, name: "Local Place B" },
    ]);
    await database.insert(crmSchema.contacts).values([
      { id: localA, firstName: "Local", lastName: "Person A" },
      { id: localB, firstName: "Local", lastName: "Person B" },
    ]);
    await database.insert(crmSchema.bookings).values([
      { id: localA, name: "Local Booking A", city: "Denver", region: "CO" },
      { id: localB, name: "Local Booking B", city: "Denver", region: "CO" },
    ]);
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

  postgresTest("stores both digests and reloads every immutable structural proposal field", async () => {
    const detailed = proposal({
      proposalKey: "contact:contact-1",
      state: "possible_duplicate",
      reviewState: "pending",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:contact-1"],
      candidateLocalIds: [localA, localB],
      proposedLocalId: localA,
      proposedPrimarySourceId: "contact-1",
      issueCode: "shared_mailbox_match_blocked",
      dependencyProposalKeys: ["organization:company-1"],
      matchReason: "shared mailbox collision",
      displaySnapshot: { email: "info@example.test", nestedValue: 1 },
    });
    const proposals = [baseProposal(), detailed];
    await store(proposals);

    const [run] = await sql!.unsafe(`
      SELECT status, source_digest, proposal_digest, summary, preview_completed_at
      FROM act_migration_runs WHERE id = '${runId}'
    `);
    const preview = await repository.getPreview(runId, { page: 1, pageSize: 100 });

    expect({
      ...run!,
      preview_completed_at: postgresTimestamp(run!.preview_completed_at),
    }).toMatchObject({
      status: "previewed",
      source_digest: "source-digest",
      proposal_digest: proposalSnapshotDigest(proposals),
      preview_completed_at: expect.any(Date),
    });
    expect(run!.summary).toEqual(report(proposals));
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.find(({ proposalKey }) => proposalKey === detailed.proposalKey)).toMatchObject(detailed);
    expect(proposalSnapshotDigest(preview.rows)).toBe(proposalSnapshotDigest(proposals));
  });

  postgresTest(
    "reloads only safe available staged Contact IDs as primary-source choices",
    async () => {
      await database.insert(crmSchema.actMigrationRecords).values([
        {
          runId,
          streamType: "contact",
          sourceKey: "contact:valid-primary",
          sourceId: "ACT-CONTACT-VALID",
          rawSnapshot: {
            id: "ACT-CONTACT-VALID",
            emailAddress: "private@example.test",
          },
          normalizedSnapshot: { displayName: "Private Contact Name" },
          fingerprint: "valid-primary",
        },
        {
          runId,
          streamType: "contact",
          sourceKey: "contact:invalid-primary",
          sourceId: "ACT-CONTACT-INVALID",
          rawSnapshot: { id: "ACT-CONTACT-INVALID", secret: "do-not-return" },
          normalizedSnapshot: {},
          fingerprint: "invalid-primary",
          errorCode: "invalid_source_record",
        },
        {
          runId,
          streamType: "contact",
          sourceKey: "contact:blank-primary",
          sourceId: "   ",
          rawSnapshot: { id: "   " },
          normalizedSnapshot: {},
          fingerprint: "blank-primary",
        },
        {
          runId,
          streamType: "contact",
          sourceKey: "contact:missing-primary",
          sourceId: null,
          rawSnapshot: {},
          normalizedSnapshot: {},
          fingerprint: "missing-primary",
        },
      ]);
      const contactProposal = proposal({
        proposalKey: "contact:safe-primary-choices",
        state: "change",
        targetEntityType: "contact",
        sourceRecordKeys: [
          "contact:valid-primary",
          "contact:invalid-primary",
          "contact:blank-primary",
          "contact:missing-primary",
        ],
        proposedPrimarySourceId: "ACT-CONTACT-VALID",
      });
      await store([baseProposal(), contactProposal]);

      const first = await repository.getPreview(runId, {
        page: 1,
        pageSize: 100,
      });
      const row = first.rows.find(
        ({ proposalKey }) => proposalKey === contactProposal.proposalKey,
      );
      expect(row?.primarySourceChoices).toEqual([{
        id: "ACT-CONTACT-VALID",
        label: "ACT-CONTACT-VALID",
        available: true,
      }]);
      expect(JSON.stringify(row?.primarySourceChoices)).not.toContain(
        "private@example.test",
      );
      expect(JSON.stringify(row?.primarySourceChoices)).not.toContain(
        "Private Contact Name",
      );
      expect(JSON.stringify(row?.primarySourceChoices)).not.toContain(
        "do-not-return",
      );

      await repository.saveDecision({
        runId,
        proposalKey: contactProposal.proposalKey,
        decision: "approve_proposed",
        decidedBy: "owner",
      });
      const reloaded = await repository.getPreview(runId, {
        page: 1,
        pageSize: 100,
      });
      expect(reloaded.rows.find(
        ({ proposalKey }) => proposalKey === contactProposal.proposalKey,
      )).toMatchObject({
        proposedPrimarySourceId: "ACT-CONTACT-VALID",
        primarySourceId: null,
        primarySourceChoices: [{
          id: "ACT-CONTACT-VALID",
          label: "ACT-CONTACT-VALID",
          available: true,
        }],
      });
    },
  );

  postgresTest("makes identical direct retries write-free and rejects a changed stored digest", async () => {
    const proposals = [baseProposal()];
    await expect(store(proposals)).resolves.toEqual({ changed: true });
    const before = await Promise.all([
      sql!.unsafe(`SELECT preview_completed_at, updated_at FROM act_migration_runs WHERE id = '${runId}'`),
      sql!.unsafe(`SELECT created_at, updated_at FROM act_migration_proposals WHERE run_id = '${runId}'`),
      sql!.unsafe(`SELECT count(*) AS count FROM audit_entries`),
    ]);

    await expect(store(proposals)).resolves.toEqual({ changed: false });
    expect(await Promise.all([
      sql!.unsafe(`SELECT preview_completed_at, updated_at FROM act_migration_runs WHERE id = '${runId}'`),
      sql!.unsafe(`SELECT created_at, updated_at FROM act_migration_proposals WHERE run_id = '${runId}'`),
      sql!.unsafe(`SELECT count(*) AS count FROM audit_entries`),
    ])).toEqual(before);
    await expect(store(proposals, { proposalDigest: "different-digest" })).rejects.toThrow("digest");
    expect(await proposalRows()).toHaveLength(1);
  });

  postgresTest("rejects invalid preview inputs atomically", async () => {
    const valid = [baseProposal()];
    const foreignRunId = "55555555-5555-4555-8555-555555555555";
    await database.insert(crmSchema.actMigrationRuns).values({
      id: foreignRunId,
      requestKey: "66666666-6666-4666-8666-666666666666",
      sourceDatabaseKey: "other-disposable-copy",
      requestedBy: "other-preview-test",
      status: "previewed",
      sourceDigest: "other-source",
      proposalDigest: "other-proposal",
      summary: {},
    });
    await database.insert(crmSchema.actMigrationProposals).values({
      runId: foreignRunId,
      proposalKey: "organization:other-run",
      state: "new",
      reviewState: "pending",
      targetEntityType: "organization",
      sourceRecordKeys: [],
      candidateLocalIds: [],
      dependencyProposalKeys: [],
      displaySnapshot: {},
    });
    const scenarios = [
      {
        name: "run and input source digest mismatch",
        input: () => storeDirect(valid, { sourceDigest: "wrong-source" }),
      },
      {
        name: "report digest mismatch",
        input: () => storeDirect(valid, {
          sourceDigest: "source-digest",
          proposalDigest: proposalSnapshotDigest(valid),
          report: report(valid, { proposalDigest: "wrong-proposal" }),
        }),
      },
      {
        name: "report source digest mismatch",
        input: () => storeDirect(valid, {
          sourceDigest: "source-digest",
          proposalDigest: proposalSnapshotDigest(valid),
          report: report(valid, { sourceDigest: "wrong-source" }),
        }),
      },
      {
        name: "incomplete report",
        input: () => storeDirect(valid, { report: report(valid, { complete: false }) }),
      },
      {
        name: "unknown staged source key",
        input: () => storeDirect([
          baseProposal(),
          proposal({ proposalKey: "unknown", sourceRecordKeys: ["company:missing"] }),
        ]),
      },
      {
        name: "duplicate source ownership",
        input: () => storeDirect([
          baseProposal(),
          proposal({ proposalKey: "duplicate", sourceRecordKeys: ["company:company-1"] }),
        ]),
      },
      {
        name: "missing or cross-run dependency",
        input: async () => {
          await insertRecord("company:dependent");
          return storeDirect([
            baseProposal(),
            proposal({
              proposalKey: "dependent",
              sourceRecordKeys: ["company:dependent"],
              dependencyProposalKeys: ["organization:other-run"],
            }),
          ]);
        },
        error: "dependency",
        cleanup: () => database.delete(crmSchema.actMigrationRecords)
          .where(eq(crmSchema.actMigrationRecords.sourceKey, "company:dependent")),
      },
    ];
    for (const scenario of scenarios) {
      if ("error" in scenario) {
        await expect(scenario.input()).rejects.toThrow(scenario.error);
      } else {
        await expect(scenario.input()).rejects.toThrow();
      }
      if ("cleanup" in scenario && scenario.cleanup) await scenario.cleanup();
      expect(await proposalRows()).toEqual([]);
      expect(await sql!.unsafe(`
        SELECT status, proposal_digest, preview_completed_at FROM act_migration_runs WHERE id = '${runId}'
      `)).toEqual([{
        status: "snapshot_complete",
        proposal_digest: null,
        preview_completed_at: null,
      }]);
      expect(await sql!.unsafe(`
        SELECT proposal_key, review_state FROM act_migration_records WHERE run_id = '${runId}' ORDER BY source_key
      `)).toEqual([{ proposal_key: null, review_state: "not_required" }]);
    }
  });

  postgresTest("paginates filtered SQL results in deterministic target-rank then proposal-key order", async () => {
    const proposals = [
      baseProposal(),
      proposal({ proposalKey: "contact:z", targetEntityType: "contact", sourceRecordKeys: ["contact:z"] }),
      proposal({ proposalKey: "contact:a", targetEntityType: "contact", sourceRecordKeys: ["contact:a"], state: "change" }),
      proposal({ proposalKey: "booking:a", targetEntityType: "booking", sourceRecordKeys: ["opportunity:a"] }),
    ];
    await store(proposals);

    await expect(repository.getPreview(runId, { page: 0, pageSize: 1 })).rejects.toThrow("one-based");
    await expect(repository.getPreview(runId, { page: 1, pageSize: 101 })).rejects.toThrow("between");
    const first = await repository.getPreview(runId, { page: 1, pageSize: 2 });
    const second = await repository.getPreview(runId, { page: 2, pageSize: 2 });
    const filtered = await repository.getPreview(runId, {
      targetEntityType: "contact",
      state: "change",
      page: 1,
      pageSize: 1,
    });

    expect(first.rows.map(({ proposalKey }) => proposalKey)).toEqual(["organization:company-1", "contact:a"]);
    expect(second.rows.map(({ proposalKey }) => proposalKey)).toEqual(["contact:z", "booking:a"]);
    expect(first.total).toBe(4);
    expect(filtered.rows.map(({ proposalKey }) => proposalKey)).toEqual(["contact:a"]);
    expect(filtered.total).toBe(1);
    expect(filtered.entityCounts).toEqual({
      organization: 0,
      contact: 1,
      organization_contact: 0,
      booking: 0,
      booking_contact: 0,
      calling_list: 0,
      calling_list_member: 0,
    });
    expect(filtered.stateCounts).toMatchObject({ new: 1, change: 1 });
  });

  postgresTest(
    "exposes safe current choices, preserves unavailable history, and rejects a removed candidate",
    async () => {
      const historical = proposal({
        proposalKey: "contact:historical-choice",
        state: "possible_duplicate",
        targetEntityType: "contact",
        sourceRecordKeys: ["contact:historical-choice"],
        candidateLocalIds: [localA, localB],
      });
      await store([baseProposal(), historical]);
      const initial = await repository.getPreview(runId, {
        page: 1,
        pageSize: 100,
      });
      expect(initial.rows.find(
        ({ proposalKey }) => proposalKey === historical.proposalKey,
      )?.candidateChoices).toEqual([
        { id: localA, label: "Local Person A", available: true },
        { id: localB, label: "Local Person B", available: true },
      ]);

      await expect(repository.saveDecision({
        runId,
        proposalKey: historical.proposalKey,
        decision: "link_existing",
        chosenLocalEntityId: localA,
        decidedBy: "owner",
      })).resolves.toEqual({ changed: true });
      await expect(repository.saveDecision({
        runId,
        proposalKey: historical.proposalKey,
        decision: "link_existing",
        chosenLocalEntityId: localA,
        decidedBy: "owner",
      })).resolves.toEqual({ changed: false });

      await database.delete(crmSchema.contacts).where(eq(crmSchema.contacts.id, localA));
      const reloaded = await repository.getPreview(runId, {
        page: 1,
        pageSize: 100,
      });
      expect(reloaded.rows.find(
        ({ proposalKey }) => proposalKey === historical.proposalKey,
      )?.candidateChoices).toContainEqual({
        id: localA,
        label: "Unavailable local record",
        available: false,
      });
      await database.delete(crmSchema.contacts).where(eq(crmSchema.contacts.id, localB));
      await expect(repository.saveDecision({
        runId,
        proposalKey: historical.proposalKey,
        decision: "link_existing",
        chosenLocalEntityId: localB,
        decidedBy: "owner",
      })).rejects.toThrow("unavailable");
    },
  );

  postgresTest(
    "holds a candidate key-share lock through the decision transaction while allowing deletion after commit",
    async () => {
      const lockable = proposal({
        proposalKey: "contact:lockable-choice",
        state: "possible_duplicate",
        targetEntityType: "contact",
        sourceRecordKeys: ["contact:lockable-choice"],
        candidateLocalIds: [localA],
      });
      await store([baseProposal(), lockable]);
      const barrierExpression =
        `hashtextextended('${schemaName}:candidate-key-share', 0)`;
      await sql!.unsafe(`
        CREATE FUNCTION act_preview_decision_barrier() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(${barrierExpression});
          RETURN NEW;
        END
        $$
      `);
      await sql!.unsafe(`
        CREATE TRIGGER act_preview_decision_barrier
        BEFORE UPDATE ON act_migration_proposals
        FOR EACH ROW EXECUTE FUNCTION act_preview_decision_barrier()
      `);

      const barrierClient = postgres(databaseUrl!, {
        max: 1,
        connection: { search_path: `${schemaName},public` },
      });
      const decisionClient = postgres(databaseUrl!, {
        max: 1,
        connection: { search_path: `${schemaName},public` },
      });
      const deleterClient = postgres(databaseUrl!, {
        max: 1,
        connection: { search_path: `${schemaName},public` },
      });
      let barrierHeld = false;
      let barrierClientEnded = false;
      let decision: Promise<{ changed: boolean }> | undefined;
      let decisionSettled = false;
      let deletion: Promise<unknown> | undefined;
      let deletionSettled = false;
      try {
        await Promise.all([
          decisionClient.unsafe("SET statement_timeout = '30s'"),
          deleterClient.unsafe("SET statement_timeout = '30s'"),
        ]);
        const [{ pid: decisionPid } = { pid: 0 }] =
          await decisionClient.unsafe<{ pid: number }[]>(
            "SELECT pg_backend_pid() AS pid",
          );
        const [{ pid: deleterPid } = { pid: 0 }] =
          await deleterClient.unsafe<{ pid: number }[]>(
            "SELECT pg_backend_pid() AS pid",
          );
        if (!decisionPid || !deleterPid) {
          throw new Error("Could not identify the lock-test sessions.");
        }

        await barrierClient.unsafe(
          `SELECT pg_advisory_lock(${barrierExpression})`,
        );
        barrierHeld = true;
        const decisionRepository = new DrizzleActMigrationPreviewRepository(
          drizzle({ client: decisionClient, schema: crmSchema }),
        );
        decision = decisionRepository.saveDecision({
          runId,
          proposalKey: lockable.proposalKey,
          decision: "link_existing",
          chosenLocalEntityId: localA,
          decidedBy: "owner",
        });
        void decision.then(
          () => {
            decisionSettled = true;
          },
          () => {
            decisionSettled = true;
          },
        );
        await waitForDatabaseLock(sql!, decisionPid, {
          expectedLockType: "advisory",
          operationSettled: () => decisionSettled,
        });

        deletion = Promise.resolve(
          deleterClient`DELETE FROM contacts WHERE id = ${localA}`,
        );
        void deletion.then(
          () => {
            deletionSettled = true;
          },
          () => {
            deletionSettled = true;
          },
        );
        await waitForDatabaseLock(sql!, deleterPid, {
          operationSettled: () => deletionSettled,
        });

        const [{ unlocked } = { unlocked: false }] =
          await barrierClient.unsafe<{ unlocked: boolean }[]>(
            `SELECT pg_advisory_unlock(${barrierExpression}) AS unlocked`,
          );
        if (!unlocked) {
          throw new Error("Could not release the decision-test advisory barrier.");
        }
        barrierHeld = false;
        await expect(decision).resolves.toEqual({ changed: true });
        await deletion;
      } finally {
        if (barrierHeld) {
          try {
            await barrierClient.unsafe("SELECT pg_advisory_unlock_all()");
          } catch {
            await barrierClient.end({ timeout: 0 });
            barrierClientEnded = true;
          }
          barrierHeld = false;
        }
        await Promise.allSettled(
          [decision, deletion].filter(
            (operation): operation is Promise<unknown> =>
              operation !== undefined,
          ),
        );
        await Promise.all([
          barrierClientEnded
            ? Promise.resolve()
            : barrierClient.end({ timeout: 5 }),
          decisionClient.end({ timeout: 5 }),
          deleterClient.end({ timeout: 5 }),
        ]);
      }
      const reloaded = await repository.getPreview(runId, {
        page: 1,
        pageSize: 100,
      });
      expect(reloaded.rows.find(
        ({ proposalKey }) => proposalKey === lockable.proposalKey,
      )?.candidateChoices).toContainEqual({
        id: localA,
        label: "Unavailable local record",
        available: false,
      });
    },
  );

  postgresTest("validates approve, link, keep-separate, orphan, and trimmed ignore decisions", async () => {
    const approvable = baseProposal();
    const noCandidate = proposal({
      proposalKey: "contact:no-candidate",
      state: "possible_duplicate",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:no-candidate"],
    });
    const duplicate = proposal({
      proposalKey: "contact:duplicate",
      state: "possible_duplicate",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:duplicate"],
      candidateLocalIds: [localA],
      issueCode: "shared_mailbox_match_blocked",
    });
    const orphan = proposal({
      proposalKey: "contact:orphan",
      state: "needs_review",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:orphan"],
      candidateLocalIds: [localA],
      issueCode: "orphaned_external_link",
    });
    const nonPersonDuplicate = proposal({
      proposalKey: "organization:not-a-person",
      state: "possible_duplicate",
      targetEntityType: "organization",
      sourceRecordKeys: ["company:not-a-person"],
      candidateLocalIds: [localA],
    });
    await store([approvable, noCandidate, duplicate, orphan, nonPersonDuplicate]);

    await repository.saveDecision({ runId, proposalKey: approvable.proposalKey, decision: "approve_proposed", decidedBy: "clerk-user" });
    await expect(repository.saveDecision({
      runId, proposalKey: noCandidate.proposalKey, decision: "approve_proposed", decidedBy: "clerk-user",
    })).rejects.toThrow("not allowed");
    await expect(repository.saveDecision({
      runId, proposalKey: noCandidate.proposalKey, decision: "link_existing", decidedBy: "clerk-user",
    })).rejects.toThrow("not allowed");
    await expect(repository.saveDecision({
      runId, proposalKey: duplicate.proposalKey, decision: "link_existing", chosenLocalEntityId: localB, decidedBy: "clerk-user",
    })).rejects.toThrow("candidate");
    await repository.saveDecision({
      runId, proposalKey: duplicate.proposalKey, decision: "keep_separate", decidedBy: "clerk-user",
    });
    await expect(repository.saveDecision({
      runId, proposalKey: orphan.proposalKey, decision: "keep_separate", decidedBy: "clerk-user",
    })).rejects.toThrow("not allowed");
    await expect(repository.saveDecision({
      runId, proposalKey: nonPersonDuplicate.proposalKey, decision: "keep_separate", decidedBy: "clerk-user",
    })).rejects.toThrow("not allowed");
    await expect(repository.saveDecision({
      runId, proposalKey: orphan.proposalKey, decision: "ignore", ignoreReason: "   ", decidedBy: "clerk-user",
    })).rejects.toThrow("reason");
    await repository.saveDecision({
      runId, proposalKey: orphan.proposalKey, decision: "ignore", ignoreReason: "  no source owner  ", decidedBy: "clerk-user",
    });

    expect(await sql!.unsafe(`
      SELECT proposal_key, review_state, decision, decision_reason FROM act_migration_proposals
      WHERE run_id = '${runId}' ORDER BY proposal_key
    `)).toEqual(expect.arrayContaining([
      expect.objectContaining({ proposal_key: "contact:orphan", decision: "ignore", decision_reason: "no source owner" }),
      expect.objectContaining({ proposal_key: "organization:company-1", review_state: "pending", decision: "approve_proposed", decision_reason: null }),
    ]));
  });

  postgresTest("enforces Contact primary authority and canonical proposed-primary decisions", async () => {
    const primary = proposal({
      proposalKey: "contact:proposed-primary",
      state: "possible_duplicate",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:primary-a", "contact:primary-b"],
      candidateLocalIds: [localA],
      proposedPrimarySourceId: "primary-a",
    });
    const explicit = proposal({
      proposalKey: "contact:explicit-primary",
      state: "possible_duplicate",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:explicit-a", "contact:explicit-b"],
      candidateLocalIds: [localA],
    });
    const approveWithPrimary = proposal({
      proposalKey: "contact:approve-primary",
      state: "new",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:approve-a", "contact:approve-b"],
    });
    await store([baseProposal(), primary, explicit, approveWithPrimary]);

    await expect(repository.saveDecision({
      runId, proposalKey: baseProposal().proposalKey, decision: "approve_proposed", primarySourceId: "company-1", decidedBy: "clerk-user",
    })).rejects.toThrow("Contact proposals");
    await expect(repository.saveDecision({
      runId, proposalKey: explicit.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, decidedBy: "clerk-user",
    })).rejects.toThrow("requires a primary");
    await expect(repository.saveDecision({
      runId, proposalKey: explicit.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, primarySourceId: "not-staged", decidedBy: "clerk-user",
    })).rejects.toThrow("not part");
    await expect(repository.saveDecision({
      runId, proposalKey: approveWithPrimary.proposalKey, decision: "approve_proposed", decidedBy: "clerk-user",
    })).rejects.toThrow("requires a primary");
    await repository.saveDecision({
      runId, proposalKey: approveWithPrimary.proposalKey, decision: "approve_proposed", primarySourceId: "approve-b", decidedBy: "clerk-user",
    });
    expect(await sql!.unsafe(`
      SELECT decision, primary_source_id FROM act_migration_proposals
      WHERE proposal_key = '${approveWithPrimary.proposalKey}'
    `)).toEqual([{
      decision: "approve_proposed",
      primary_source_id: "approve-b",
    }]);
    await expect(repository.saveDecision({
      runId, proposalKey: primary.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, primarySourceId: "primary-b", decidedBy: "clerk-user",
    })).rejects.toThrow("cannot be overridden");
    await repository.saveDecision({
      runId, proposalKey: primary.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, decidedBy: "clerk-user",
    });
    const [primaryBeforeRetry] = await sql!.unsafe(`
      SELECT decided_at, decided_by FROM act_migration_proposals WHERE proposal_key = '${primary.proposalKey}'
    `);
    const auditsBeforeEqualPrimaryRetry = await auditRows();
    await repository.saveDecision({
      runId, proposalKey: primary.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, primarySourceId: "primary-a", decidedBy: "other-clerk-user",
    });
    expect(await auditRows()).toEqual(auditsBeforeEqualPrimaryRetry);
    expect(await sql!.unsafe(`
      SELECT decided_at, decided_by FROM act_migration_proposals WHERE proposal_key = '${primary.proposalKey}'
    `)).toEqual([primaryBeforeRetry]);
    await repository.saveDecision({
      runId, proposalKey: explicit.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, primarySourceId: "explicit-b", decidedBy: "clerk-user",
    });

    expect(await sql!.unsafe(`
      SELECT proposal_key, primary_source_id FROM act_migration_proposals
      WHERE proposal_key IN ('contact:proposed-primary', 'contact:explicit-primary') ORDER BY proposal_key
    `)).toEqual([
      { proposal_key: "contact:explicit-primary", primary_source_id: "explicit-b" },
      { proposal_key: "contact:proposed-primary", primary_source_id: null },
    ]);
    expect(await auditRows()).toHaveLength(auditsBeforeEqualPrimaryRetry.length + 1);
  });

  postgresTest("persists decisions across repository recreation and suppresses semantic-retry audits", async () => {
    const duplicate = proposal({
      proposalKey: "contact:durable",
      state: "possible_duplicate",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:durable"],
      candidateLocalIds: [localA],
    });
    await store([baseProposal(), duplicate]);
    const input = {
      runId,
      proposalKey: duplicate.proposalKey,
      decision: "link_existing" as const,
      chosenLocalEntityId: localA,
      decidedBy: "clerk-user",
    };
    await repository.saveDecision(input);
    const [saved] = await sql!.unsafe(`
      SELECT decided_at FROM act_migration_proposals WHERE proposal_key = '${duplicate.proposalKey}'
    `);
    const audits = await auditRows();
    repository = new DrizzleActMigrationPreviewRepository(database);
    await repository.saveDecision({ ...input, decidedBy: "another-clerk-user" });
    const preview = await repository.getPreview(runId, { page: 1, pageSize: 100 });

    const durableDecision = preview.rows.find(
      ({ proposalKey }) => proposalKey === duplicate.proposalKey,
    );
    expect(durableDecision).toMatchObject({
      decision: "link_existing",
      chosenLocalEntityId: localA,
      decidedBy: "clerk-user",
    });
    expect(postgresTimestamp(durableDecision!.decidedAt)).toEqual(
      postgresTimestamp(saved!.decided_at),
    );
    expect(await auditRows()).toEqual(audits);
  });

  postgresTest("clears incompatible metadata, leaves unresolved parents untouched, and preserves not-required records", async () => {
    const changeable = proposal({
      proposalKey: "contact:changeable",
      state: "possible_duplicate",
      targetEntityType: "contact",
      sourceRecordKeys: ["contact:changeable"],
      candidateLocalIds: [localA],
    });
    const parent = proposal({
      proposalKey: "organization:parent",
      state: "needs_review",
      sourceRecordKeys: ["company:parent"],
      issueCode: "opportunity_place_missing",
    });
    const child = proposal({
      proposalKey: "booking:child",
      state: "needs_review",
      targetEntityType: "booking",
      sourceRecordKeys: ["opportunity:child"],
      dependencyProposalKeys: [parent.proposalKey],
      issueCode: "parent_proposal_unresolved",
    });
    const notRequired = proposal({
      proposalKey: "organization:not-required",
      sourceRecordKeys: ["company:not-required"],
      reviewState: "not_required",
    });
    await store([baseProposal(), changeable, parent, child, notRequired]);
    expect(await sql!.unsafe(`
      SELECT review_state FROM act_migration_records WHERE source_key = 'contact:changeable'
    `)).toEqual([{ review_state: "pending" }]);
    await repository.saveDecision({ runId, proposalKey: changeable.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, decidedBy: "clerk-user" });
    expect(await sql!.unsafe(`
      SELECT review_state FROM act_migration_records WHERE source_key = 'contact:changeable'
    `)).toEqual([{ review_state: "decided" }]);
    await repository.saveDecision({ runId, proposalKey: changeable.proposalKey, decision: "ignore", ignoreReason: "changed mind", decidedBy: "clerk-user" });
    expect(await sql!.unsafe(`
      SELECT review_state FROM act_migration_records WHERE source_key = 'contact:changeable'
    `)).toEqual([{ review_state: "ignored" }]);
    expect(await sql!.unsafe(`
      SELECT decision, chosen_local_entity_id, primary_source_id, decision_reason
      FROM act_migration_proposals WHERE proposal_key = '${changeable.proposalKey}'
    `)).toEqual([{
      decision: "ignore",
      chosen_local_entity_id: null,
      primary_source_id: null,
      decision_reason: "changed mind",
    }]);
    await repository.saveDecision({ runId, proposalKey: changeable.proposalKey, decision: "link_existing", chosenLocalEntityId: localA, decidedBy: "clerk-user" });
    expect(await sql!.unsafe(`
      SELECT review_state FROM act_migration_records WHERE source_key = 'contact:changeable'
    `)).toEqual([{ review_state: "decided" }]);
    await repository.saveDecision({ runId, proposalKey: child.proposalKey, decision: "ignore", ignoreReason: "wait for parent", decidedBy: "clerk-user" });
    await repository.saveDecision({ runId, proposalKey: notRequired.proposalKey, decision: "ignore", ignoreReason: "not required", decidedBy: "clerk-user" });

    expect(await sql!.unsafe(`
      SELECT source_key, review_state FROM act_migration_records
      WHERE source_key IN ('company:parent', 'opportunity:child', 'company:not-required') ORDER BY source_key
    `)).toEqual([
      { source_key: "company:not-required", review_state: "not_required" },
      { source_key: "company:parent", review_state: "pending" },
      { source_key: "opportunity:child", review_state: "ignored" },
    ]);
  });

  postgresTest("keeps audit payloads metadata-only and rolls proposal, record, and audit changes back on audit failure", async () => {
    const reviewable = proposal({
      proposalKey: "organization:audit",
      sourceRecordKeys: ["company:audit"],
      displaySnapshot: { rawSourceMustNeverAppear: "secret" },
    });
    await store([baseProposal(), reviewable]);
    await repository.saveDecision({ runId, proposalKey: reviewable.proposalKey, decision: "ignore", ignoreReason: "audit me", decidedBy: "clerk-user" });
    const [audit] = await auditRows();
    expect(audit).toMatchObject({
      entity_type: "act_migration_proposal",
      action: "review_decision_changed",
      before: {
        decision: null,
        decisionReason: null,
        chosenLocalEntityId: null,
        primarySourceId: null,
      },
      after: {
        decision: "ignore",
        decisionReason: "audit me",
        chosenLocalEntityId: null,
        primarySourceId: null,
      },
    });
    expect(Object.keys(audit!.before).toSorted()).toEqual([
      "chosenLocalEntityId", "decision", "decisionReason", "primarySourceId",
    ]);
    expect(Object.keys(audit!.after).toSorted()).toEqual([
      "chosenLocalEntityId", "decision", "decisionReason", "primarySourceId",
    ]);
    expect(JSON.stringify(audit)).not.toContain("rawSourceMustNeverAppear");
    expect(JSON.stringify(audit)).not.toContain("display_snapshot");
    expect(JSON.stringify(audit)).not.toContain("confidential");
    expect(JSON.stringify(audit)).not.toContain("not-audit");

    await sql!.unsafe(`
      CREATE FUNCTION reject_preview_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.entity_type = 'act_migration_proposal' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
        RETURN NEW;
      END $$
    `);
    await sql!.unsafe(`
      CREATE TRIGGER reject_preview_audit BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION reject_preview_audit();
    `);
    let auditFailure: unknown;
    try {
      await repository.saveDecision({
        runId, proposalKey: reviewable.proposalKey, decision: "approve_proposed", decidedBy: "clerk-user",
      });
    } catch (error) {
      auditFailure = error;
    }
    const auditFailureMessages = errorCauseMessages(auditFailure);
    expect(auditFailure).toBeInstanceOf(Error);
    expect(auditFailureMessages[0]).toContain(
      'Failed query: insert into "audit_entries"',
    );
    expect(auditFailureMessages).toContain("forced audit failure");
    expect(await Promise.all([
      sql!.unsafe(`SELECT decision, decision_reason FROM act_migration_proposals WHERE proposal_key = '${reviewable.proposalKey}'`),
      sql!.unsafe(`SELECT review_state FROM act_migration_records WHERE source_key = 'company:audit'`),
      sql!.unsafe(`SELECT count(*) AS count FROM audit_entries`),
    ])).toEqual([
      [
      { decision: "ignore", decision_reason: "audit me" },
      ],
      [
      { review_state: "ignored" },
      ],
      [
      { count: "1" },
      ],
    ]);
  });

  postgresTest("does not mutate CRM or relationship sentinel tables while saving decisions", async () => {
    const reviewable = proposal({ proposalKey: "organization:sentinel", sourceRecordKeys: ["company:sentinel"] });
    await store([baseProposal(), reviewable]);
    await database.insert(crmSchema.organizations).values({
      id: "77777777-7777-4777-8777-777777777777",
      name: "Sentinel Organization",
      city: "Denver",
      region: "CO",
    });
    await database.insert(crmSchema.contacts).values({
      id: "88888888-8888-4888-8888-888888888888",
      firstName: "Sentinel",
      lastName: "Person",
      email: "sentinel@example.test",
    });
    await database.insert(crmSchema.bookings).values({
      id: "99999999-9999-4999-8999-999999999999",
      name: "Sentinel Booking",
      city: "Denver",
      region: "CO",
    });
    await database.insert(crmSchema.organizationContacts).values({
      organizationId: "77777777-7777-4777-8777-777777777777",
      contactId: "88888888-8888-4888-8888-888888888888",
      role: "Sentinel role",
      isPrimary: true,
      active: true,
      source: "local",
    });
    await database.insert(crmSchema.bookingContacts).values({
      bookingId: "99999999-9999-4999-8999-999999999999",
      contactId: "88888888-8888-4888-8888-888888888888",
      role: "Sentinel booking role",
      isPrimary: true,
      source: "local",
    });
    await database.insert(crmSchema.actExternalLinks).values({
      entityType: "calling_list",
      sourceEntityType: "group",
      entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actRecordId: "GROUP-SENTINEL",
      isPrimary: false,
      syncMode: "pull_only",
    });
    const before = await crmSentinels();
    await repository.saveDecision({ runId, proposalKey: reviewable.proposalKey, decision: "approve_proposed", decidedBy: "clerk-user" });
    expect(await crmSentinels()).toEqual(before);
  });
});

describe("ActMigrationPreviewService", () => {
  it("returns an existing immutable preview before reading the snapshot or local candidates", async () => {
    const reconciliation = report([baseProposal()]);
    const stored = {
      runId,
      rows: [],
      report: reconciliation,
      page: 1,
      pageSize: 50,
      total: 0,
      entityCounts: {
        organization: 0,
        contact: 0,
        organization_contact: 0,
        booking: 0,
        booking_contact: 0,
        calling_list: 0,
        calling_list_member: 0,
      },
      stateCounts: {
        new: 0,
        matched_unchanged: 0,
        change: 0,
        new_relationship: 0,
        possible_duplicate: 0,
        needs_review: 0,
        ignored: 0,
        error: 0,
      },
    };
    const service = new ActMigrationPreviewService(
      { finalizeSourceSnapshot: async () => { throw new Error("snapshot should not be read"); } } as never,
      { loadCandidateSnapshot: async () => { throw new Error("local candidates should not be read"); } },
      {
        getPreviewIfStored: async () => stored,
        getPreview: async () => { throw new Error("stored preview should be returned directly"); },
        storeProposalsIfAbsent: async () => { throw new Error("stored preview should not be written"); },
        saveDecision: async () => ({ changed: false }),
      },
    );

    await expect(service.finalizePreview(runId)).resolves.toEqual({
      preview: stored,
      changed: false,
    });
  });

  it.each([true, false])(
    "preserves repository changed=%s after building a new preview",
    async (changed) => {
      const reconciliation = report([]);
      const stored = {
        runId,
        rows: [],
        report: reconciliation,
        page: 1,
        pageSize: 50,
        total: 0,
        entityCounts: {
          organization: 0,
          contact: 0,
          organization_contact: 0,
          booking: 0,
          booking_contact: 0,
          calling_list: 0,
          calling_list_member: 0,
        },
        stateCounts: {
          new: 0,
          matched_unchanged: 0,
          change: 0,
          new_relationship: 0,
          possible_duplicate: 0,
          needs_review: 0,
          ignored: 0,
          error: 0,
        },
      };
      const checkpoints = [
        "company",
        "contact",
        "opportunity",
        "group",
      ].map((streamType) => ({
        id: randomUUID(),
        runId,
        streamType,
        partitionKey: "root",
        parentSourceId: null,
        nextSkip: 0,
        pageSize: 100,
        queryMode: "projected",
        status: "complete",
        retryAfter: null,
        retryable: true,
      }));
      const service = new ActMigrationPreviewService(
        {
          finalizeSourceSnapshot: async () => ({
            runId,
            records: [],
            checkpoints,
            sourceDigest:
              "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          }),
        } as never,
        {
          loadCandidateSnapshot: async () => ({
            places: [],
            people: [],
            bookings: [],
            placePeople: [],
            bookingPeople: [],
            externalLinks: [],
          }),
        },
        {
          getPreviewIfStored: async () => null,
          getPreview: async () => stored,
          storeProposalsIfAbsent: async () => ({ changed }),
          saveDecision: async () => ({ changed: false }),
        },
      );

      await expect(service.finalizePreview(runId)).resolves.toEqual({
        preview: stored,
        changed,
      });
    },
  );
});
