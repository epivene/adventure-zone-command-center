import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { db as applicationDatabase } from "@/db/client";
import * as schema from "@workspace/db/schema";
import {
  ActArchiveConflictError,
  archivePageAction,
  archiveReceiptAction,
  archiveStreamAllowedForCheckpoint,
  derivedCheckpointsAllowedByCapabilities,
  DrizzleActSourceArchiveRepository,
  replayedCheckpointTransition,
  type ArchiveSourceItem,
} from "./archive-repository";
import type { DerivedCheckpointSpec } from "./import-types";

describe("Act derived checkpoint capability filtering", () => {
  it("allows a contact link emitted with a contact-note page", () => {
    expect(
      archiveStreamAllowedForCheckpoint("note", "relationship", "note"),
    ).toBe(true);
    expect(
      archiveStreamAllowedForCheckpoint("note", "relationship", "note_contact"),
    ).toBe(true);
    expect(
      archiveStreamAllowedForCheckpoint("note", "detail", "note_contact"),
    ).toBe(false);
    expect(
      archiveStreamAllowedForCheckpoint(
        "note",
        "relationship",
        "company_contact",
      ),
    ).toBe(false);
    expect(
      archiveStreamAllowedForCheckpoint(
        "contact",
        "relationship",
        "note_contact",
      ),
    ).toBe(false);
  });

  const detail = (
    streamType: "contact" | "company",
    partitionKey: string,
  ): DerivedCheckpointSpec => ({
    streamType,
    checkpointKind: "detail",
    partitionKey,
    requiredness: "required",
    parentSourceRecordId: null,
    parentActRecordId: partitionKey,
    sourceRecordId: null,
    nextSkip: 0,
    pageSize: 100,
    queryMode: "projected",
    deriveDetails: false,
  });

  it("suppresses only same-root details with a durable unavailable marker", () => {
    const contactDetail = detail("contact", "detail:contact-1");
    const companyDetail = detail("company", "detail:company-1");
    const relationship: DerivedCheckpointSpec = {
      ...contactDetail,
      streamType: "company_contact",
      checkpointKind: "relationship",
      partitionKey: "relationship:contact-1",
      requiredness: "optional_capability",
    };
    const input = [contactDetail, companyDetail, relationship];

    expect(
      derivedCheckpointsAllowedByCapabilities(input, new Set(["contact"])),
    ).toEqual([companyDetail, relationship]);
    expect(input).toEqual([contactDetail, companyDetail, relationship]);
  });

  it("keeps exact receipt replay idempotent after extraction but blocks new writes", () => {
    expect(archivePageAction("extract_complete", true)).toBe("replay");
    expect(() => archivePageAction("extract_complete", false)).toThrowError(
      new ActArchiveConflictError(),
    );
    expect(archivePageAction("extracting", false)).toBe("write");
  });

  it("accepts a replay when only volatile Act page metadata changed", () => {
    expect(
      archiveReceiptAction(
        "extracting",
        {
          runId: "run-1",
          streamType: "company_contact",
          nextSkip: 100,
          queryMode: "projected",
          pageFingerprint: "first-response",
          responseRows: 100,
        },
        {
          runId: "run-1",
          streamType: "company_contact",
          nextSkip: null,
          queryMode: "plain",
          pageFingerprint: "reordered-replay",
          responseRows: 99,
        },
      ),
    ).toBe("replay");
  });

  it("finishes a checkpoint from the stored terminal page receipt", () => {
    expect(
      replayedCheckpointTransition({
        pageSkip: 0,
        nextSkip: null,
        queryMode: "projected",
        responseRows: 1,
      }),
    ).toEqual({
      nextSkip: 0,
      queryMode: "projected",
      state: "complete",
    });
  });

  it("finishes a checkpoint from a stranded zero-row receipt", () => {
    expect(
      replayedCheckpointTransition({
        pageSkip: 0,
        nextSkip: 0,
        queryMode: "projected",
        responseRows: 0,
      }),
    ).toEqual({
      nextSkip: 0,
      queryMode: "projected",
      state: "complete",
    });
  });
});

const describeWithPostgres = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithPostgres("Act source archive repository on PostgreSQL", () => {
  type QueryResult<Row> = { rows: Row[] };
  type TestPool = {
    query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  };

  const schemaName = `act_archive_repository_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schemaName}"`;
  let pool: TestPool;
  let repository: DrizzleActSourceArchiveRepository;

  beforeAll(async () => {
    const pgModuleUrl = new URL(
      "../../../../../lib/db/node_modules/pg/lib/index.js",
      import.meta.url,
    );
    const pgModule = (await import(pgModuleUrl.href)) as {
      default: {
        Pool: new (config: {
          connectionString: string;
          options: string;
        }) => TestPool;
      };
    };
    const { Pool } = pgModule.default;
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL!,
      options: `-c search_path=${schemaName},public`,
    });
    await pool.query(`CREATE SCHEMA ${quotedSchema}`);
    const migrationPath = fileURLToPath(
      new URL(
        "../../../../../lib/db/migrations/006_act_replacement_archive.sql",
        import.meta.url,
      ),
    );
    await pool.query(await readFile(migrationPath, "utf8"));
    const database = drizzle(pool as never, {
      schema,
    }) as unknown as typeof applicationDatabase;
    repository = new DrizzleActSourceArchiveRepository(database);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await pool.end();
  });

  async function seedLeasedCheckpoint(input: {
    databaseKey: string;
    streamType?: string;
    nextSkip?: number;
    leaseOwner?: string;
    requestKey?: string;
  }) {
    const streamType = input.streamType ?? "contact";
    const nextSkip = input.nextSkip ?? 0;
    const leaseOwner = input.leaseOwner ?? "worker-a";
    const run = await pool.query<{ id: string }>(
      `INSERT INTO act_replacement_runs
         (request_key, source_database_key, requested_by, page_size)
       VALUES ($1, $2, 'owner', 100)
       RETURNING id`,
      [input.requestKey ?? randomUUID(), input.databaseKey],
    );
    const checkpoint = await pool.query<{ id: string }>(
      `INSERT INTO act_replacement_checkpoints
         (run_id, source_database_key, stream_type, checkpoint_kind,
          partition_key, requiredness, next_skip, page_size, state,
          lease_owner, lease_expires_at)
       VALUES ($1, $2, $3, 'list', 'root', 'required', $4, 100, 'leased',
               $5, now() + interval '5 minutes')
       RETURNING id`,
      [run.rows[0]!.id, input.databaseKey, streamType, nextSkip, leaseOwner],
    );
    return {
      runId: run.rows[0]!.id,
      checkpointId: checkpoint.rows[0]!.id,
      leaseOwner,
      expectedSkip: nextSkip,
    };
  }

  async function seedAdditionalCheckpoint(input: {
    runId: string;
    databaseKey: string;
    partitionKey: string;
    nextSkip?: number;
    leaseOwner?: string;
  }) {
    const leaseOwner = input.leaseOwner ?? "worker-a";
    const checkpoint = await pool.query<{ id: string }>(
      `INSERT INTO act_replacement_checkpoints
         (run_id, source_database_key, stream_type, checkpoint_kind,
          partition_key, requiredness, next_skip, page_size, state,
          lease_owner, lease_expires_at)
       VALUES ($1, $2, 'contact', 'detail', $3, 'required', $4, 100,
               'leased', $5, now() + interval '5 minutes')
       RETURNING id`,
      [
        input.runId,
        input.databaseKey,
        input.partitionKey,
        input.nextSkip ?? 0,
        leaseOwner,
      ],
    );
    return {
      runId: input.runId,
      checkpointId: checkpoint.rows[0]!.id,
      leaseOwner,
      expectedSkip: input.nextSkip ?? 0,
    };
  }

  function sourceItem(
    overrides: Partial<ArchiveSourceItem> = {},
  ): ArchiveSourceItem {
    return {
      streamType: "contact",
      sourceKey: randomUUID(),
      actRecordId: randomUUID(),
      snapshotScope: "list_projected",
      archiveCompleteness: "complete",
      raw: { name: "Ada", authorization: "private credential" },
      relationshipEvidence: {
        companyId: "company-1",
        access_token: "private credential",
      },
      sourceCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
      sourceEditedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  it("archives a page and treats a changed Act replay as the same committed page", async () => {
    const context = await seedLeasedCheckpoint({ databaseKey: "archive-page" });
    const items = [
      sourceItem({ sourceKey: "complete", actRecordId: "contact-complete" }),
      sourceItem({
        sourceKey: "partial",
        actRecordId: "contact-partial",
        archiveCompleteness: "partial",
        raw: { name: "Grace" },
      }),
      sourceItem({
        sourceKey: "failed",
        actRecordId: "contact-failed",
        archiveCompleteness: "failed",
        raw: { name: "Katherine" },
      }),
    ];
    const now = new Date("2026-08-01T12:00:00.000Z");

    await expect(
      repository.archiveCheckpointPage({
        ...context,
        items,
        derivedCheckpoints: [
          {
            streamType: "company_contact",
            checkpointKind: "relationship",
            partitionKey: "company-contact:complete",
            requiredness: "optional_capability",
            parentSourceRecordId: null,
            parentActRecordId: "company-1",
            sourceRecordId: null,
            nextSkip: 0,
            pageSize: 100,
            queryMode: "projected",
            deriveDetails: false,
          },
        ],
        nextSkip: 3,
        queryMode: "plain",
        pageFingerprint: "page-one",
        now,
      }),
    ).resolves.toEqual({
      responseRows: 3,
      observedIdentities: 3,
      archivedIdentities: 3,
      completeIdentities: 1,
      partialIdentities: 1,
      failedIdentities: 1,
      snapshotVersionsInserted: 3,
    });

    const stored = await pool.query<{
      raw_snapshot: Record<string, unknown>;
      relationship_evidence: Record<string, unknown>;
    }>(
      `SELECT v.raw_snapshot, s.relationship_evidence
       FROM act_source_record_versions v
       JOIN act_source_records s ON s.id = v.source_record_id
       WHERE s.source_database_key = 'archive-page' AND s.source_key = 'complete'`,
    );
    expect(stored.rows).toEqual([
      {
        raw_snapshot: { name: "Ada" },
        relationship_evidence: { companyId: "company-1" },
      },
    ]);

    const checkpoint = await pool.query<{
      state: string;
      lease_owner: string | null;
      lease_expires_at: Date | null;
      next_skip: number;
      query_mode: string;
      response_rows: number;
      observed_identities: number;
      archived_identities: number;
      complete_identities: number;
      partial_identities: number;
      failed_identities: number;
      snapshot_versions_inserted: number;
    }>("SELECT * FROM act_replacement_checkpoints WHERE id = $1", [
      context.checkpointId,
    ]);
    expect(checkpoint.rows[0]).toMatchObject({
      state: "pending",
      lease_owner: null,
      lease_expires_at: null,
      next_skip: 3,
      query_mode: "plain",
      response_rows: 3,
      observed_identities: 3,
      archived_identities: 3,
      complete_identities: 1,
      partial_identities: 1,
      failed_identities: 1,
      snapshot_versions_inserted: 3,
    });
    await expect(
      pool.query(
        "SELECT 1 FROM act_replacement_page_receipts WHERE checkpoint_id = $1",
        [context.checkpointId],
      ),
    ).resolves.toMatchObject({ rows: [{}] });
    await expect(
      pool.query(
        "SELECT 1 FROM act_replacement_observations WHERE run_id = $1",
        [context.runId],
      ),
    ).resolves.toMatchObject({ rows: [{}, {}, {}] });
    await expect(
      pool.query(
        "SELECT 1 FROM act_replacement_checkpoints WHERE run_id = $1 AND partition_key = 'company-contact:complete'",
        [context.runId],
      ),
    ).resolves.toMatchObject({ rows: [{}] });

    await expect(
      repository.archiveCheckpointPage({
        ...context,
        items: [items[0]!],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "projected",
        pageFingerprint: "page-one-reordered-replay",
        now,
      }),
    ).resolves.toEqual({
      responseRows: 0,
      observedIdentities: 0,
      archivedIdentities: 0,
      completeIdentities: 0,
      partialIdentities: 0,
      failedIdentities: 0,
      snapshotVersionsInserted: 0,
    });
    const replayCounts = await pool.query<{
      receipts: string;
      sources: string;
      versions: string;
      observations: string;
      children: string;
    }>(
      `SELECT
         (SELECT count(*) FROM act_replacement_page_receipts WHERE checkpoint_id = $1) receipts,
         (SELECT count(*) FROM act_source_records WHERE source_database_key = 'archive-page') sources,
         (SELECT count(*) FROM act_source_record_versions v JOIN act_source_records s ON s.id = v.source_record_id WHERE s.source_database_key = 'archive-page') versions,
         (SELECT count(*) FROM act_replacement_observations WHERE run_id = $2) observations,
         (SELECT count(*) FROM act_replacement_checkpoints WHERE run_id = $2 AND partition_key = 'company-contact:complete') children`,
      [context.checkpointId, context.runId],
    );
    expect(replayCounts.rows[0]).toEqual({
      receipts: "1",
      sources: "3",
      versions: "3",
      observations: "3",
      children: "1",
    });
  });

  it("completes a re-leased checkpoint from its existing terminal receipt", async () => {
    const context = await seedLeasedCheckpoint({
      databaseKey: "archive-stranded-replay",
      streamType: "company_contact",
      leaseOwner: "first-worker",
    });
    const firstPage = {
      ...context,
      items: [
        sourceItem({
          streamType: "company_contact",
          sourceKey: "company-contact-1",
          actRecordId: null,
        }),
      ],
      derivedCheckpoints: [],
      nextSkip: null,
      queryMode: "projected" as const,
      pageFingerprint: "first-response",
      now: new Date("2026-08-01T12:00:00.000Z"),
    };
    await repository.archiveCheckpointPage(firstPage);
    await pool.query(
      `UPDATE act_replacement_checkpoints
       SET state = 'leased', lease_owner = 'replay-worker',
           lease_expires_at = now() + interval '5 minutes', completed_at = NULL
       WHERE id = $1`,
      [context.checkpointId],
    );

    await repository.archiveCheckpointPage({
      ...firstPage,
      leaseOwner: "replay-worker",
      nextSkip: 100,
      queryMode: "plain",
      pageFingerprint: "volatile-replay-response",
      now: new Date("2026-08-01T13:00:00.000Z"),
    });

    await expect(
      pool.query(
        `SELECT state, next_skip, query_mode, lease_owner, lease_expires_at,
                response_rows, observed_identities, archived_identities
         FROM act_replacement_checkpoints WHERE id = $1`,
        [context.checkpointId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          state: "complete",
          next_skip: 0,
          query_mode: "projected",
          lease_owner: null,
          lease_expires_at: null,
          response_rows: 1,
          observed_identities: 1,
          archived_identities: 1,
        },
      ],
    });
  });

  it("completes and normalizes an empty page with a non-advancing cursor", async () => {
    const context = await seedLeasedCheckpoint({
      databaseKey: "archive-empty-cursor",
      streamType: "group_contact",
    });

    await repository.archiveCheckpointPage({
      ...context,
      items: [],
      derivedCheckpoints: [],
      nextSkip: context.expectedSkip,
      queryMode: "projected",
      pageFingerprint: "empty-response",
      now: new Date("2026-08-01T12:00:00.000Z"),
    });

    await expect(
      pool.query(
        `SELECT c.state, c.next_skip, c.lease_owner, r.next_skip receipt_next_skip
         FROM act_replacement_checkpoints c
         JOIN act_replacement_page_receipts r ON r.checkpoint_id = c.id
         WHERE c.id = $1`,
        [context.checkpointId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          state: "complete",
          next_skip: context.expectedSkip,
          lease_owner: null,
          receipt_next_skip: null,
        },
      ],
    });
  });

  it("replays an exact receipt without mutation after the run advances phase", async () => {
    const context = await seedLeasedCheckpoint({
      databaseKey: "archive-replay-after-phase",
    });
    const item = sourceItem({
      sourceKey: "phase-replay-contact",
      actRecordId: "phase-replay-contact",
    });
    const page = {
      ...context,
      items: [item],
      derivedCheckpoints: [],
      nextSkip: null,
      queryMode: "projected" as const,
      pageFingerprint: "phase-replay-page",
      now: new Date("2026-08-01T12:00:00.000Z"),
    };
    await repository.archiveCheckpointPage(page);
    await pool.query(
      `UPDATE act_replacement_runs
       SET phase = 'extract_complete', extract_completed_at = now()
       WHERE id = $1`,
      [context.runId],
    );

    await expect(repository.archiveCheckpointPage(page)).resolves.toEqual({
      responseRows: 0,
      observedIdentities: 0,
      archivedIdentities: 0,
      completeIdentities: 0,
      partialIdentities: 0,
      failedIdentities: 0,
      snapshotVersionsInserted: 0,
    });

    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::text FROM act_replacement_page_receipts WHERE checkpoint_id = $1) receipts,
           (SELECT count(*)::text FROM act_source_records WHERE source_database_key = $2) sources,
           (SELECT count(*)::text FROM act_source_record_versions v JOIN act_source_records s ON s.id = v.source_record_id WHERE s.source_database_key = $2) versions,
           (SELECT count(*)::text FROM act_replacement_observations WHERE run_id = $3) observations,
           response_rows, observed_identities, archived_identities,
           complete_identities, state, lease_owner
         FROM act_replacement_checkpoints WHERE id = $1`,
        [context.checkpointId, "archive-replay-after-phase", context.runId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          receipts: "1",
          sources: "1",
          versions: "1",
          observations: "1",
          response_rows: 1,
          observed_identities: 1,
          archived_identities: 1,
          complete_identities: 1,
          state: "complete",
          lease_owner: null,
        },
      ],
    });
  });

  it("adds only an observation for unchanged sanitized content in a later run and a version for changed content", async () => {
    const first = await seedLeasedCheckpoint({
      databaseKey: "archive-versioning",
    });
    const original = sourceItem({
      sourceKey: "same-contact",
      actRecordId: "same-contact",
      raw: { name: "Ada", token: "first credential" },
    });
    await repository.archiveCheckpointPage({
      ...first,
      items: [original],
      derivedCheckpoints: [],
      nextSkip: null,
      queryMode: "projected",
      pageFingerprint: "first-page",
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    await pool.query(
      "UPDATE act_replacement_runs SET phase = 'complete' WHERE id = $1",
      [first.runId],
    );

    const second = await seedLeasedCheckpoint({
      databaseKey: "archive-versioning",
    });
    await expect(
      repository.archiveCheckpointPage({
        ...second,
        items: [
          sourceItem({
            ...original,
            snapshotScope: "detail",
            raw: { token: "different credential", name: "Ada" },
          }),
        ],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "plain",
        pageFingerprint: "unrelated-page-metadata",
        now: new Date("2026-08-02T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ snapshotVersionsInserted: 0 });
    await pool.query(
      "UPDATE act_replacement_runs SET phase = 'complete' WHERE id = $1",
      [second.runId],
    );

    const third = await seedLeasedCheckpoint({
      databaseKey: "archive-versioning",
    });
    await expect(
      repository.archiveCheckpointPage({
        ...third,
        items: [sourceItem({ ...original, raw: { name: "Ada Lovelace" } })],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "projected",
        pageFingerprint: "third-page",
        now: new Date("2026-08-03T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ snapshotVersionsInserted: 1 });

    const counts = await pool.query<{ versions: string; observations: string }>(
      `SELECT
         (SELECT count(*) FROM act_source_record_versions v JOIN act_source_records s ON s.id = v.source_record_id WHERE s.source_database_key = 'archive-versioning') versions,
         (SELECT count(*) FROM act_replacement_observations o JOIN act_source_records s ON s.id = o.source_record_id WHERE s.source_database_key = 'archive-versioning') observations`,
    );
    expect(counts.rows[0]).toEqual({ versions: "2", observations: "3" });
  });

  it("counts one terminal completeness per run identity and moves its category on transition", async () => {
    const databaseKey = "archive-completeness-transition";
    const first = await seedLeasedCheckpoint({ databaseKey });
    const item = sourceItem({
      sourceKey: "transition-contact",
      actRecordId: "transition-contact",
      archiveCompleteness: "partial",
      raw: { name: "Ada" },
    });
    await repository.archiveCheckpointPage({
      ...first,
      items: [item],
      derivedCheckpoints: [],
      nextSkip: null,
      queryMode: "projected",
      pageFingerprint: "transition-first",
      now: new Date("2026-08-01T12:00:00.000Z"),
    });

    const duplicate = await seedAdditionalCheckpoint({
      runId: first.runId,
      databaseKey,
      partitionKey: "detail:transition-contact:duplicate",
      nextSkip: 50,
    });
    await expect(
      repository.archiveCheckpointPage({
        ...duplicate,
        items: [item],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "plain",
        pageFingerprint: "transition-duplicate",
        now: new Date("2026-08-01T13:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      observedIdentities: 0,
      archivedIdentities: 0,
      partialIdentities: 0,
    });

    const transition = await seedAdditionalCheckpoint({
      runId: first.runId,
      databaseKey,
      partitionKey: "detail:transition-contact:complete",
      nextSkip: 100,
    });
    await expect(
      repository.archiveCheckpointPage({
        ...transition,
        items: [{ ...item, archiveCompleteness: "complete" }],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "projected",
        pageFingerprint: "transition-complete",
        now: new Date("2026-08-01T14:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      observedIdentities: 0,
      archivedIdentities: 0,
      completeIdentities: 1,
      partialIdentities: 0,
    });

    const totals = await pool.query<{
      observed: string;
      archived: string;
      complete: string;
      partial: string;
      failed: string;
      observations: string;
    }>(
      `SELECT
         sum(observed_identities)::text observed,
         sum(archived_identities)::text archived,
         sum(complete_identities)::text complete,
         sum(partial_identities)::text partial,
         sum(failed_identities)::text failed,
         (SELECT count(*)::text FROM act_replacement_observations WHERE run_id = $1) observations
       FROM act_replacement_checkpoints
       WHERE run_id = $1 AND stream_type = 'contact'`,
      [first.runId],
    );
    expect(totals.rows[0]).toEqual({
      observed: "1",
      archived: "1",
      complete: "1",
      partial: "0",
      failed: "0",
      observations: "1",
    });
  });

  it.each([
    ["wrong lease owner", { leaseOwner: "other-worker" }],
    ["wrong cursor", { expectedSkip: 100 }],
    ["wrong run", { runId: "00000000-0000-0000-0000-000000000001" }],
  ])("rejects %s without storing the page", async (_name, mismatch) => {
    const context = await seedLeasedCheckpoint({
      databaseKey: `archive-conflict-${randomUUID()}`,
    });

    await expect(
      repository.archiveCheckpointPage({
        ...context,
        ...mismatch,
        items: [sourceItem()],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "projected",
        pageFingerprint: "conflicting-page",
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ActArchiveConflictError);

    const effects = await pool.query<{ receipts: string; sources: string }>(
      `SELECT
         (SELECT count(*) FROM act_replacement_page_receipts WHERE checkpoint_id = $1) receipts,
         (SELECT count(*) FROM act_source_records WHERE first_seen_run_id = $2) sources`,
      [context.checkpointId, context.runId],
    );
    expect(effects.rows[0]).toEqual({ receipts: "0", sources: "0" });
  });

  it("rejects an item from a different stream without exposing its values", async () => {
    const context = await seedLeasedCheckpoint({
      databaseKey: "archive-stream-conflict",
    });
    const privateValue = "private-source-value";

    await expect(
      repository.archiveCheckpointPage({
        ...context,
        items: [sourceItem({ streamType: "company", raw: { privateValue } })],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "projected",
        pageFingerprint: "stream-conflict-page",
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      message: "Act archive checkpoint state no longer matches.",
    });
    try {
      await repository.archiveCheckpointPage({
        ...context,
        items: [sourceItem({ streamType: "company", raw: { privateValue } })],
        derivedCheckpoints: [],
        nextSkip: null,
        queryMode: "projected",
        pageFingerprint: "stream-conflict-page",
        now: new Date("2026-08-01T12:00:00.000Z"),
      });
    } catch (error) {
      expect(String(error)).not.toContain(privateValue);
    }
  });

  it("rolls back receipt, archive, observation, counters, and derived work on a late failure", async () => {
    const context = await seedLeasedCheckpoint({
      databaseKey: "archive-rollback",
    });

    await expect(
      repository.archiveCheckpointPage({
        ...context,
        items: [sourceItem({ sourceKey: "rollback-contact" })],
        derivedCheckpoints: [
          {
            streamType: "company_contact",
            checkpointKind: "relationship",
            partitionKey: "invalid-derived-page-size",
            requiredness: "optional_capability",
            parentSourceRecordId: null,
            parentActRecordId: null,
            sourceRecordId: null,
            nextSkip: 0,
            pageSize: 0,
            queryMode: "projected",
            deriveDetails: false,
          },
        ],
        nextSkip: null,
        queryMode: "projected",
        pageFingerprint: "rollback-page",
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).rejects.toBeDefined();

    const effects = await pool.query<{
      receipts: string;
      sources: string;
      versions: string;
      observations: string;
      children: string;
      response_rows: number;
      state: string;
      lease_owner: string;
      next_skip: number;
    }>(
      `SELECT
         (SELECT count(*) FROM act_replacement_page_receipts WHERE checkpoint_id = $1) receipts,
         (SELECT count(*) FROM act_source_records WHERE source_database_key = 'archive-rollback') sources,
         (SELECT count(*) FROM act_source_record_versions v JOIN act_source_records s ON s.id = v.source_record_id WHERE s.source_database_key = 'archive-rollback') versions,
         (SELECT count(*) FROM act_replacement_observations WHERE run_id = $2) observations,
         (SELECT count(*) FROM act_replacement_checkpoints WHERE run_id = $2 AND partition_key = 'invalid-derived-page-size') children,
         response_rows, state, lease_owner, next_skip
       FROM act_replacement_checkpoints WHERE id = $1`,
      [context.checkpointId, context.runId],
    );
    expect(effects.rows[0]).toEqual({
      receipts: "0",
      sources: "0",
      versions: "0",
      observations: "0",
      children: "0",
      response_rows: 0,
      state: "leased",
      lease_owner: context.leaseOwner,
      next_skip: 0,
    });
  });
});
