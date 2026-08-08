import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { db as applicationDatabase } from "@/db/client";
import * as schema from "@workspace/db/schema";
import { DrizzleActSourceArchiveRepository } from "./archive-repository";
import {
  ActCheckpointConflictError,
  DrizzleActReplacementCheckpointRepository,
} from "./checkpoint-repository";

const describeWithPostgres = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithPostgres("Act replacement checkpoints on PostgreSQL", () => {
  type QueryResult<Row> = { rows: Row[] };
  type TestClient = {
    query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    release(): void;
  };
  type TestPool = {
    query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    connect(): Promise<TestClient>;
    end(): Promise<void>;
  };

  const schemaName = `act_checkpoint_repository_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schemaName}"`;
  let pool: TestPool;
  let repository: DrizzleActReplacementCheckpointRepository;
  let archiveRepository: DrizzleActSourceArchiveRepository;

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
    repository = new DrizzleActReplacementCheckpointRepository(database);
    archiveRepository = new DrizzleActSourceArchiveRepository(database);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await pool.end();
  });

  afterEach(async () => {
    if (!pool) return;
    await pool.query(
      `UPDATE act_replacement_runs
       SET phase = 'superseded', superseded_at = now(), updated_at = now()
       WHERE phase IN ('extracting', 'extract_complete', 'organizing',
                       'ready_to_apply', 'applying')`,
    );
  });

  function startInput(
    overrides: Partial<{
      requestKey: string;
      sourceDatabaseKey: string;
      requestedBy: string;
      pageSize: 25 | 50 | 100 | 200;
    }> = {},
  ) {
    return {
      requestKey: randomUUID(),
      sourceDatabaseKey: `database-${randomUUID()}`,
      requestedBy: "owner@example.com",
      pageSize: 100 as const,
      ...overrides,
    };
  }

  async function seedCheckpoint(input: {
    runId: string;
    databaseKey: string;
    streamType?: string;
    kind?: string;
    partitionKey?: string;
    requiredness?: string;
    state?: string;
    leaseOwner?: string | null;
    leaseExpiresAt?: Date | null;
    retryAfter?: Date | null;
    nextSkip?: number;
    queryMode?: string;
    deriveDetails?: boolean;
    counters?: Partial<{
      responseRows: number;
      observedIdentities: number;
      archivedIdentities: number;
      completeIdentities: number;
      partialIdentities: number;
      failedIdentities: number;
      snapshotVersionsInserted: number;
    }>;
  }) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO act_replacement_checkpoints
         (run_id, source_database_key, stream_type, checkpoint_kind,
          partition_key, requiredness, state, lease_owner, lease_expires_at,
          retry_after, next_skip, page_size, query_mode, derive_details,
          response_rows, observed_identities, archived_identities,
          complete_identities, partial_identities, failed_identities,
          snapshot_versions_inserted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,100,$12,$13,
               $14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        input.runId,
        input.databaseKey,
        input.streamType ?? "contact",
        input.kind ?? "detail",
        input.partitionKey ?? randomUUID(),
        input.requiredness ?? "required",
        input.state ?? "pending",
        input.leaseOwner ?? null,
        input.leaseExpiresAt ?? null,
        input.retryAfter ?? null,
        input.nextSkip ?? 0,
        input.queryMode ?? "projected",
        input.deriveDetails ?? true,
        input.counters?.responseRows ?? 0,
        input.counters?.observedIdentities ?? 0,
        input.counters?.archivedIdentities ?? 0,
        input.counters?.completeIdentities ?? 0,
        input.counters?.partialIdentities ?? 0,
        input.counters?.failedIdentities ?? 0,
        input.counters?.snapshotVersionsInserted ?? 0,
      ],
    );
    return result.rows[0]!.id;
  }

  async function waitForRowLock(query: string, values: readonly unknown[]) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          await client.query(`${query} FOR UPDATE NOWAIT`, values);
          await client.query("ROLLBACK");
        } catch (error) {
          await client.query("ROLLBACK");
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "55P03"
          ) {
            return;
          }
          throw error;
        }
      } finally {
        client.release();
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Timed out waiting for the PostgreSQL row lock.");
  }

  it("creates six global roots and leaves notes to contact-scoped checkpoints", async () => {
    const input = startInput();
    const first = await repository.createRun(input);
    const replay = await repository.createRun(input);

    expect(first.created).toBe(true);
    expect(replay).toEqual({ runId: first.runId, created: false });
    const checkpoints = await pool.query<{
      stream_type: string;
      checkpoint_kind: string;
      partition_key: string;
      requiredness: string;
      source_database_key: string;
      page_size: number;
      derive_details: boolean;
    }>(
      `SELECT stream_type, checkpoint_kind, partition_key, requiredness,
              source_database_key, page_size, derive_details
       FROM act_replacement_checkpoints WHERE run_id = $1
       ORDER BY stream_type`,
      [first.runId],
    );
    expect(checkpoints.rows).toEqual(
      ["activity", "company", "contact", "group", "history", "opportunity"].map(
        (stream) => ({
          stream_type: stream,
          checkpoint_kind: "list",
          partition_key: `root:${stream}`,
          requiredness: "required",
          source_database_key: input.sourceDatabaseKey,
          page_size: 100,
          derive_details: true,
        }),
      ),
    );
  });

  it("returns one active run when different requests start concurrently", async () => {
    const databaseKey = `database-${randomUUID()}`;
    const [left, right] = await Promise.all([
      repository.createRun(startInput({ sourceDatabaseKey: databaseKey })),
      repository.createRun(startInput({ sourceDatabaseKey: databaseKey })),
    ]);

    expect(left.runId).toBe(right.runId);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    await expect(
      pool.query(
        `SELECT 1 FROM act_replacement_runs
         WHERE source_database_key = $1 AND phase = 'extracting'`,
        [databaseKey],
      ),
    ).resolves.toMatchObject({ rows: [{}] });
  });

  it("claims deterministically with SKIP LOCKED, excludes active leases, and reclaims expiry", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");

    const first = await repository.claimNext({
      workerId: "worker-a",
      now,
      leaseMs: 60_000,
    });
    const second = await repository.claimNext({
      workerId: "worker-b",
      now,
      leaseMs: 60_000,
    });
    expect(first?.streamType).toBe("company");
    expect(second?.id).not.toBe(first?.id);
    expect(first).toMatchObject({
      runId,
      sourceDatabaseKey: input.sourceDatabaseKey,
      leaseOwner: "worker-a",
      attemptCount: 1,
    });

    await pool.query(
      `UPDATE act_replacement_checkpoints
       SET state = 'complete', completed_at = $2, lease_owner = NULL,
           lease_expires_at = NULL
       WHERE run_id = $1 AND id <> $3`,
      [runId, now, first!.id],
    );
    await expect(
      repository.claimNext({ workerId: "worker-c", now, leaseMs: 60_000 }),
    ).resolves.toBeNull();

    const reclaimed = await repository.claimNext({
      workerId: "worker-c",
      now: new Date("2026-08-01T12:01:00.000Z"),
      leaseMs: 60_000,
    });
    expect(reclaimed).toMatchObject({
      id: first!.id,
      leaseOwner: "worker-c",
      attemptCount: 2,
    });
  });

  it("skips a concurrently locked highest-priority checkpoint", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT id FROM act_replacement_checkpoints
         WHERE run_id = $1 AND stream_type = 'company' FOR UPDATE`,
        [runId],
      );
      await expect(
        repository.claimNext({
          workerId: "skip-locked-worker",
          now: new Date("2026-08-01T12:00:00.000Z"),
          leaseMs: 60_000,
        }),
      ).resolves.toMatchObject({
        runId,
        streamType: "contact",
        checkpointKind: "list",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("switches a live projected lease to plain mode without moving its cursor", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const checkpointId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      partitionKey: "detail:plain-switch",
      state: "leased",
      leaseOwner: "worker-a",
      leaseExpiresAt: new Date("2026-08-01T12:01:00.000Z"),
      nextSkip: 125,
    });

    await repository.switchToPlain({
      checkpointId,
      leaseOwner: "worker-a",
      now,
    });

    await expect(
      pool.query(
        `SELECT state, next_skip, query_mode, lease_owner, lease_expires_at
         FROM act_replacement_checkpoints WHERE id = $1`,
        [checkpointId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          state: "pending",
          next_skip: 125,
          query_mode: "plain",
          lease_owner: null,
          lease_expires_at: null,
        },
      ],
    });
  });

  it("atomically requeues authorization work and removes its claim attempt", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const claimed = await repository.claimNext({
      workerId: "authorization-worker",
      now,
      leaseMs: 60_000,
    });

    await repository.releaseForAuthorization({
      checkpointId: claimed!.id,
      leaseOwner: "authorization-worker",
      now,
    });

    await expect(
      pool.query<{
        state: string;
        attempt_count: number;
        lease_owner: string | null;
        lease_expires_at: Date | null;
      }>(
        `SELECT state, attempt_count, lease_owner, lease_expires_at
         FROM act_replacement_checkpoints WHERE id = $1`,
        [claimed!.id],
      ),
    ).resolves.toEqual({
      rows: [
        {
          state: "pending",
          attempt_count: 0,
          lease_owner: null,
          lease_expires_at: null,
        },
      ],
    });
  });

  it("schedules retry from the persisted attempt and honors a later capped Retry-After", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const checkpointId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      partitionKey: "retry-me",
      state: "leased",
      leaseOwner: "worker-a",
      leaseExpiresAt: new Date("2026-08-01T12:01:00.000Z"),
    });
    await pool.query(
      "UPDATE act_replacement_checkpoints SET attempt_count = 3 WHERE id = $1",
      [checkpointId],
    );

    await repository.scheduleRetry({
      checkpointId,
      leaseOwner: "worker-a",
      errorCode: "rate_limited",
      retryable: true,
      retryAfter: new Date("2026-08-01T13:00:00.000Z"),
      now,
    });

    await expect(
      pool.query(
        `SELECT state, retry_after, retryable, error_code, lease_owner
         FROM act_replacement_checkpoints WHERE id = $1`,
        [checkpointId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          state: "retry_wait",
          retry_after: new Date("2026-08-01T12:15:00.000Z"),
          retryable: true,
          error_code: "rate_limited",
          lease_owner: null,
        },
      ],
    });
  });

  it("isolates ordinary permanent failures but terminalizes an account failure", async () => {
    const ordinaryInput = startInput();
    const ordinary = await repository.createRun(ordinaryInput);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const ordinaryClaim = await repository.claimNext({
      workerId: "worker-a",
      now,
      leaseMs: 60_000,
    });
    await repository.markFailed({
      checkpointId: ordinaryClaim!.id,
      leaseOwner: "worker-a",
      errorCode: "invalid_response",
      retryable: false,
      retryAfter: null,
      now,
    });
    const ordinaryStates = await pool.query<{ state: string }>(
      "SELECT state FROM act_replacement_checkpoints WHERE run_id = $1",
      [ordinary.runId],
    );
    expect(
      ordinaryStates.rows.filter(({ state }) => state === "failed"),
    ).toHaveLength(1);
    expect(
      ordinaryStates.rows.filter(({ state }) => state === "pending"),
    ).toHaveLength(6);
    await repository.supersedeRun({
      runId: ordinary.runId,
      requestedBy: ordinaryInput.requestedBy,
      now,
    });

    const accountInput = startInput();
    const account = await repository.createRun(accountInput);
    const accountClaim = await repository.claimNext({
      workerId: "worker-b",
      now,
      leaseMs: 60_000,
    });
    await repository.markFailed({
      checkpointId: accountClaim!.id,
      leaseOwner: "worker-b",
      errorCode: "authentication_failed",
      retryable: false,
      retryAfter: null,
      now,
    });
    const accountRows = await pool.query<{ state: string; error_code: string }>(
      "SELECT state, error_code FROM act_replacement_checkpoints WHERE run_id = $1",
      [account.runId],
    );
    expect(accountRows.rows).toHaveLength(7);
    expect(accountRows.rows.every((row) => row.state === "failed")).toBe(true);
    expect(
      accountRows.rows.every(
        (row) => row.error_code === "authentication_failed",
      ),
    ).toBe(true);
    await expect(
      pool.query(
        "SELECT phase, last_error_code FROM act_replacement_runs WHERE id = $1",
        [account.runId],
      ),
    ).resolves.toMatchObject({
      rows: [{ phase: "failed", last_error_code: "authentication_failed" }],
    });
  });

  it("resumes notes that failed on the retired singular contact-note route", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const noteCheckpointId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      streamType: "note",
      kind: "relationship",
      partitionKey: "contact-notes:contact-1",
      state: "failed",
      queryMode: "plain",
      deriveDetails: false,
    });
    const unrelatedCheckpointId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      streamType: "contact",
      kind: "detail",
      partitionKey: "detail:contact-1",
      state: "failed",
    });
    await pool.query(
      `UPDATE act_replacement_checkpoints
       SET error_code = 'not_found', retryable = false, completed_at = $2
       WHERE id IN ($1, $3)`,
      [noteCheckpointId, now, unrelatedCheckpointId],
    );
    await pool.query(
      `UPDATE act_replacement_runs
       SET phase = 'failed', last_error_code = 'not_found', completed_at = $2
       WHERE id = $1`,
      [runId, now],
    );

    await expect(repository.summarize(runId)).resolves.toMatchObject({
      phase: "failed",
      canResume: true,
    });

    await repository.resumeRun({ runId, now });

    await expect(
      pool.query<{ id: string; state: string; error_code: string | null }>(
        `SELECT id, state, error_code
         FROM act_replacement_checkpoints
         WHERE id IN ($1, $2)
         ORDER BY id`,
        [noteCheckpointId, unrelatedCheckpointId],
      ),
    ).resolves.toMatchObject({
      rows: expect.arrayContaining([
        { id: noteCheckpointId, state: "pending", error_code: null },
        {
          id: unrelatedCheckpointId,
          state: "failed",
          error_code: "not_found",
        },
      ]),
    });
    await expect(
      pool.query<{
        phase: string;
        last_error_code: string | null;
        completed_at: Date | null;
      }>(
        `SELECT phase, last_error_code, completed_at
         FROM act_replacement_runs
         WHERE id = $1`,
        [runId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          phase: "extracting",
          last_error_code: null,
          completed_at: null,
        },
      ],
    });
  });

  it("requeues a leased checkpoint even when its recorded expiry is in the future", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const checkpointId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      streamType: "company_contact",
      kind: "relationship",
      partitionKey: "company-contact:company-1",
      state: "leased",
      leaseOwner: "stranded-worker",
      leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    await expect(repository.resumeRun({ runId, now })).resolves.toEqual({
      recoveredCheckpointCount: 1,
      states: { "company_contact:relationship": 1 },
    });

    await expect(
      pool.query<{
        state: string;
        lease_owner: string | null;
        lease_expires_at: Date | null;
      }>(
        `SELECT state, lease_owner, lease_expires_at
         FROM act_replacement_checkpoints
         WHERE id = $1`,
        [checkpointId],
      ),
    ).resolves.toEqual({
      rows: [
        {
          state: "pending",
          lease_owner: null,
          lease_expires_at: null,
        },
      ],
    });
  });

  it("locks the run before waiting to recover a checkpoint", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const checkpointId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      streamType: "company_contact",
      kind: "relationship",
      partitionKey: "company-contact:lock-order",
      state: "leased",
      leaseOwner: "stranded-worker",
      leaseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT id FROM act_replacement_checkpoints WHERE id = $1 FOR UPDATE",
      [checkpointId],
    );

    const resuming = repository.resumeRun({ runId, now });
    try {
      await waitForRowLock(
        "SELECT id FROM act_replacement_runs WHERE id = $1",
        [runId],
      );
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }

    await expect(resuming).resolves.toEqual({
      recoveredCheckpointCount: 1,
      states: { "company_contact:relationship": 1 },
    });
  });

  it("terminalizes every open checkpoint on permission denial", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const claimed = await repository.claimNext({
      workerId: "permission-worker",
      now,
      leaseMs: 60_000,
    });
    await repository.markUnsupported({
      checkpointId: claimed!.id,
      leaseOwner: "permission-worker",
      errorCode: "permission_denied",
      retryable: false,
      retryAfter: null,
      now,
    });

    const rows = await pool.query<{ state: string; error_code: string }>(
      "SELECT state, error_code FROM act_replacement_checkpoints WHERE run_id = $1",
      [runId],
    );
    expect(rows.rows).toHaveLength(7);
    expect(
      rows.rows.every(
        (row) =>
          row.state === "failed" && row.error_code === "permission_denied",
      ),
    ).toBe(true);
  });

  it("keeps an optional unsupported checkpoint named and nonblocking", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    await pool.query(
      `UPDATE act_replacement_checkpoints
       SET state = 'complete', completed_at = $2 WHERE run_id = $1`,
      [runId, now],
    );
    const optionalId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      streamType: "activity_contact",
      kind: "relationship",
      partitionKey: "activity-contact:1",
      requiredness: "optional_capability",
      state: "leased",
      leaseOwner: "worker-a",
      leaseExpiresAt: new Date("2026-08-01T12:01:00.000Z"),
    });

    await repository.markUnsupported({
      checkpointId: optionalId,
      leaseOwner: "worker-a",
      errorCode: "endpoint_unsupported",
      retryable: false,
      retryAfter: null,
      now,
    });
    const status = await repository.summarize(runId);

    expect(status.phase).toBe("extract_complete");
    expect(status.allStreams.unsupportedCapabilities).toBe(1);
    expect(
      status.streams.find(({ streamType }) => streamType === "activity_contact")
        ?.error,
    ).toEqual({
      code: "endpoint_unsupported",
      retryable: false,
      retryAfter: null,
    });
  });

  it("supersedes execution without deleting permanent archives", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const source = await pool.query<{ id: string }>(
      `INSERT INTO act_source_records
         (source_database_key, stream_type, source_key, first_seen_run_id, last_seen_run_id)
       VALUES ($1, 'contact', 'kept', $2, $2) RETURNING id`,
      [input.sourceDatabaseKey, runId],
    );
    await pool.query(
      `INSERT INTO act_source_record_versions
         (source_record_id, source_database_key, fingerprint, raw_snapshot,
          snapshot_scope, observed_run_id)
       VALUES ($1, $2, 'kept-fingerprint', '{"name":"Kept"}', 'detail', $3)`,
      [source.rows[0]!.id, input.sourceDatabaseKey, runId],
    );

    await repository.supersedeRun({
      runId,
      requestedBy: input.requestedBy,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });

    await expect(
      pool.query("SELECT phase FROM act_replacement_runs WHERE id = $1", [
        runId,
      ]),
    ).resolves.toMatchObject({ rows: [{ phase: "superseded" }] });
    await expect(
      pool.query(
        "SELECT raw_snapshot FROM act_source_record_versions WHERE source_record_id = $1",
        [source.rows[0]!.id],
      ),
    ).resolves.toMatchObject({ rows: [{ raw_snapshot: { name: "Kept" } }] });
  });

  it("claims database-derived work after constructing a new repository", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    await pool.query(
      "UPDATE act_replacement_checkpoints SET state = 'complete' WHERE run_id = $1",
      [runId],
    );
    const derivedId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      partitionKey: "derived-after-restart",
    });
    const database = drizzle(pool as never, {
      schema,
    }) as unknown as typeof applicationDatabase;
    const restarted = new DrizzleActReplacementCheckpointRepository(database);

    await expect(
      restarted.claimNext({
        workerId: "restarted",
        now: new Date("2026-08-01T12:00:00.000Z"),
        leaseMs: 60_000,
      }),
    ).resolves.toMatchObject({ id: derivedId, leaseOwner: "restarted" });
  });

  it("atomically records one same-root detail limitation and one plain fallback under concurrency", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    await pool.query(
      "UPDATE act_replacement_checkpoints SET state = 'complete' WHERE run_id = $1",
      [runId],
    );
    const now = new Date("2026-08-01T12:00:00.000Z");
    const [leftId, rightId, pendingId] = await Promise.all(
      ["left", "right", "pending"].map((partition, index) =>
        seedCheckpoint({
          runId,
          databaseKey: input.sourceDatabaseKey,
          streamType: "contact",
          kind: "detail",
          partitionKey: `detail:${partition}`,
          state: index < 2 ? "leased" : "pending",
          leaseOwner: index < 2 ? `worker-${partition}` : null,
          leaseExpiresAt:
            index < 2 ? new Date("2026-08-01T12:01:00.000Z") : null,
        }),
      ),
    );

    const [left, right] = await Promise.all([
      repository.markDetailCapabilityUnavailable({
        runId,
        checkpointId: leftId!,
        leaseOwner: "worker-left",
        rootStream: "contact",
        now,
      }),
      repository.markDetailCapabilityUnavailable({
        runId,
        checkpointId: rightId!,
        leaseOwner: "worker-right",
        rootStream: "contact",
        now,
      }),
    ]);

    expect(left.fallbackCheckpointId).toBe(right.fallbackCheckpointId);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
    const detailRows = await pool.query<{
      id: string;
      requiredness: string;
      state: string;
      error_code: string;
    }>(
      `SELECT id, requiredness, state, error_code
       FROM act_replacement_checkpoints
       WHERE run_id = $1 AND stream_type = 'contact' AND checkpoint_kind = 'detail'`,
      [runId],
    );
    expect(detailRows.rows.map(({ id }) => id).sort()).toEqual(
      [leftId, rightId, pendingId].sort(),
    );
    expect(
      detailRows.rows.every(
        (row) => row.requiredness === "optional_capability",
      ),
    ).toBe(true);
    expect(detailRows.rows.every((row) => row.state === "unsupported")).toBe(
      true,
    );
    expect(
      detailRows.rows.every((row) => row.error_code === "endpoint_unsupported"),
    ).toBe(true);
    await expect(
      pool.query(
        `SELECT id, requiredness, state, partition_key, next_skip, query_mode, derive_details
         FROM act_replacement_checkpoints
         WHERE run_id = $1 AND stream_type = 'contact'
           AND checkpoint_kind = 'plain_list_fallback'`,
        [runId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          id: left.fallbackCheckpointId,
          requiredness: "optional_capability",
          state: "pending",
          partition_key: "plain-full:contact",
          next_skip: 0,
          query_mode: "plain",
          derive_details: false,
        },
      ],
    });
  });

  it("suppresses a detail derivation that started before its capability marker committed", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const root = await pool.query<{ id: string; stream_type: string }>(
      `UPDATE act_replacement_checkpoints
       SET state = CASE WHEN stream_type = 'contact' THEN 'leased' ELSE 'complete' END,
           lease_owner = CASE WHEN stream_type = 'contact' THEN 'archive-worker' ELSE NULL END,
           lease_expires_at = CASE WHEN stream_type = 'contact' THEN $2 ELSE NULL END,
           completed_at = CASE WHEN stream_type = 'contact' THEN NULL ELSE $1 END
       WHERE run_id = $3
       RETURNING id, stream_type`,
      [now, new Date("2026-08-01T12:05:00.000Z"), runId],
    );
    const rootId = root.rows.find(
      ({ stream_type }) => stream_type === "contact",
    )!.id;
    const triggerId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      streamType: "contact",
      kind: "detail",
      partitionKey: "detail:capability-trigger",
      state: "leased",
      leaseOwner: "detail-worker",
      leaseExpiresAt: new Date("2026-08-01T12:05:00.000Z"),
    });
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT id FROM act_replacement_checkpoints WHERE id = $1 FOR UPDATE",
      [triggerId],
    );

    const marking = repository.markDetailCapabilityUnavailable({
      runId,
      checkpointId: triggerId,
      leaseOwner: "detail-worker",
      rootStream: "contact",
      now,
    });
    await waitForRowLock("SELECT id FROM act_replacement_runs WHERE id = $1", [
      runId,
    ]);
    const archiving = archiveRepository.archiveCheckpointPage({
      runId,
      checkpointId: rootId,
      leaseOwner: "archive-worker",
      expectedSkip: 0,
      items: [],
      derivedCheckpoints: [
        {
          streamType: "contact",
          checkpointKind: "detail",
          partitionKey: "detail:derived-during-race",
          requiredness: "required",
          parentSourceRecordId: null,
          parentActRecordId: "contact-race",
          sourceRecordId: null,
          nextSkip: 0,
          pageSize: 100,
          queryMode: "projected",
          deriveDetails: false,
        },
      ],
      nextSkip: null,
      queryMode: "projected",
      pageFingerprint: "capability-race-page",
      now,
    });

    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.all([marking, archiving]);

    await expect(
      pool.query(
        `SELECT partition_key, requiredness, state
         FROM act_replacement_checkpoints
         WHERE run_id = $1 AND stream_type = 'contact'
           AND partition_key IN ('plain-full:contact', 'detail:derived-during-race')
         ORDER BY partition_key`,
        [runId],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          partition_key: "plain-full:contact",
          requiredness: "optional_capability",
          state: "pending",
        },
      ],
    });
  });

  it("serializes summarize with final page archival and derived insertion without deadlock", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const root = await pool.query<{ id: string; stream_type: string }>(
      `UPDATE act_replacement_checkpoints
       SET state = CASE WHEN stream_type = 'contact' THEN 'leased' ELSE 'complete' END,
           lease_owner = CASE WHEN stream_type = 'contact' THEN 'archive-worker' ELSE NULL END,
           lease_expires_at = CASE WHEN stream_type = 'contact' THEN $2 ELSE NULL END,
           completed_at = CASE WHEN stream_type = 'contact' THEN NULL ELSE $1 END
       WHERE run_id = $3
       RETURNING id, stream_type`,
      [now, new Date("2026-08-01T12:05:00.000Z"), runId],
    );
    const rootId = root.rows.find(
      ({ stream_type }) => stream_type === "contact",
    )!.id;
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "LOCK TABLE act_replacement_page_receipts IN ACCESS EXCLUSIVE MODE",
    );

    const archiving = archiveRepository.archiveCheckpointPage({
      runId,
      checkpointId: rootId,
      leaseOwner: "archive-worker",
      expectedSkip: 0,
      items: [],
      derivedCheckpoints: [
        {
          streamType: "company_contact",
          checkpointKind: "relationship",
          partitionKey: "relationship:derived-at-final-page",
          requiredness: "optional_capability",
          parentSourceRecordId: null,
          parentActRecordId: "company-race",
          sourceRecordId: null,
          nextSkip: 0,
          pageSize: 100,
          queryMode: "projected",
          deriveDetails: false,
        },
      ],
      nextSkip: null,
      queryMode: "projected",
      pageFingerprint: "summarize-race-page",
      now,
    });
    await waitForRowLock(
      "SELECT id FROM act_replacement_checkpoints WHERE id = $1",
      [rootId],
    );
    const summarizing = repository.summarize(runId);
    await waitForRowLock("SELECT id FROM act_replacement_runs WHERE id = $1", [
      runId,
    ]);

    await blocker.query("ROLLBACK");
    blocker.release();
    const [, status] = await Promise.all([archiving, summarizing]);

    expect(status.phase).toBe("extracting");
    await expect(
      pool.query(
        `SELECT state FROM act_replacement_checkpoints
         WHERE run_id = $1 AND partition_key = 'relationship:derived-at-final-page'`,
        [runId],
      ),
    ).resolves.toMatchObject({ rows: [{ state: "pending" }] });
  });

  it("finalizes only with required success, version-backed observations, and exact per-stream equations", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const now = new Date("2026-08-01T12:00:00.000Z");
    await pool.query(
      `UPDATE act_replacement_checkpoints
       SET state = 'complete', completed_at = $2 WHERE run_id = $1`,
      [runId, now],
    );
    const source = await pool.query<{ id: string }>(
      `INSERT INTO act_source_records
         (source_database_key, stream_type, source_key, first_seen_run_id, last_seen_run_id,
          archive_completeness)
       VALUES ($1, 'contact', 'equation-contact', $2, $2, 'partial') RETURNING id`,
      [input.sourceDatabaseKey, runId],
    );
    const version = await pool.query<{ id: string }>(
      `INSERT INTO act_source_record_versions
         (source_record_id, source_database_key, fingerprint, raw_snapshot,
          snapshot_scope, observed_run_id)
       VALUES ($1, $2, 'equation-version', '{"id":"equation-contact"}', 'list_projected', $3)
       RETURNING id`,
      [source.rows[0]!.id, input.sourceDatabaseKey, runId],
    );
    await pool.query(
      `INSERT INTO act_replacement_observations
         (run_id, source_database_key, source_record_id, version_id, snapshot_scope)
       VALUES ($1, $2, $3, $4, 'list_projected')`,
      [runId, input.sourceDatabaseKey, source.rows[0]!.id, version.rows[0]!.id],
    );
    await expect(repository.summarize(runId)).resolves.toMatchObject({
      phase: "extracting",
    });

    await pool.query(
      `UPDATE act_replacement_checkpoints
       SET observed_identities = 1, archived_identities = 1, partial_identities = 1,
           snapshot_versions_inserted = 1
       WHERE run_id = $1 AND stream_type = 'contact' AND checkpoint_kind = 'list'`,
      [runId],
    );
    await expect(repository.summarize(runId)).resolves.toMatchObject({
      phase: "extract_complete",
      allStreams: {
        observedIdentities: 1,
        archivedIdentities: 1,
        completeIdentities: 0,
        partialIdentities: 1,
        failedIdentities: 0,
      },
    });
  });

  it("does not finalize when required work failed or unsupported", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    await pool.query(
      `UPDATE act_replacement_checkpoints
       SET state = CASE WHEN stream_type = 'contact' THEN 'failed' ELSE 'complete' END,
           error_code = CASE WHEN stream_type = 'contact' THEN 'invalid_response' ELSE NULL END,
           retryable = false, completed_at = now()
       WHERE run_id = $1`,
      [runId],
    );

    const status = await repository.summarize(runId);
    expect(status.phase).toBe("failed");
    expect(status.canResume).toBe(false);
  });

  it("rejects stale lease owners with a fixed data-free conflict", async () => {
    const input = startInput();
    const { runId } = await repository.createRun(input);
    const checkpointId = await seedCheckpoint({
      runId,
      databaseKey: input.sourceDatabaseKey,
      partitionKey: "private-source-value",
      state: "leased",
      leaseOwner: "actual-owner-private-value",
      leaseExpiresAt: new Date("2026-08-01T12:01:00.000Z"),
    });

    await expect(
      repository.markFailed({
        checkpointId,
        leaseOwner: "wrong-owner-private-value",
        errorCode: "invalid_response",
        retryable: false,
        retryAfter: null,
        now: new Date("2026-08-01T12:00:00.000Z"),
      }),
    ).rejects.toEqual(new ActCheckpointConflictError());
  });
});
