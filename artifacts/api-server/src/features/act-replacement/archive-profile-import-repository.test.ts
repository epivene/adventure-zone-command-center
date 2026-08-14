import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { db as ApplicationDatabase } from "@/db/client";
import { DrizzleSyncRepository } from "../act-sync/sync-repository";
import { resolveArchiveProfile } from "./archive-profile-resolver";
import {
  DrizzleArchiveProfileImportRepository,
  type ClaimedArchiveProfileJob,
} from "./archive-profile-import-repository";
import type {
  ArchiveProfileResolution,
  ArchiveProfileSource,
} from "./archive-profile-import-types";

type QueryResult<Row> = { rows: Row[] };
type TestPool = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  connect(): Promise<{
    query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
    release(): void;
  }>;
  end(): Promise<void>;
};

type Harness = {
  schemaName: string;
  pool: TestPool;
  repository: DrizzleArchiveProfileImportRepository;
};

type SeededSource = {
  sourceRecordId: string;
  sourceVersionId: string;
  source: ArchiveProfileSource;
};

const databaseKey = "archive-profile-test";
const owner = "owner@example.com";
const now = () => new Date();
const repositoryTests = process.env.TEST_DATABASE_URL ? describe : describe.skip;
let harness: Harness | undefined;
const aiPreserveResolution = {
  action: "preserve",
  reasonCode: "ai_low_confidence",
  evidenceLabels: ["ai_review"],
  provenance: {
    resolutionPolicyVersion: "archive-profile-ai-v1",
    aiProvider: "openai",
    aiConfidence: "low",
  },
} satisfies ArchiveProfileResolution;
const providerRetryResolution = {
  action: "retry_later",
  reasonCode: "ai_unavailable",
  evidenceLabels: ["ai_unavailable"],
  provenance: {
    resolutionPolicyVersion: "archive-profile-ai-v1",
    aiProvider: "openai",
    aiConfidence: null,
  },
} satisfies ArchiveProfileResolution;
const staleAlreadyImportedResolution = {
  action: "already_imported",
  targetEntityType: "contact",
  targetEntityId: orderedUuid(3),
  values: {},
  evidenceLabels: ["source_link"],
} satisfies ArchiveProfileResolution;
const staleLoadedLinkResolution = {
  action: "link_existing",
  targetEntityType: "contact",
  targetEntityId: orderedUuid(3),
  values: {
    firstName: "Casey",
    lastName: "Jones",
    email: "casey@example.com",
  },
  evidenceLabels: ["email"],
} satisfies ArchiveProfileResolution;

describe("archive profile import concurrency and batch SQL contracts", () => {
  it("prelocks targets before links and caps relationship evidence without an overflow row", async () => {
    const repositorySource = await readFile(
      fileURLToPath(new URL("./archive-profile-import-repository.ts", import.meta.url)),
      "utf8",
    );
    const entityApplySource = await readFile(
      fileURLToPath(new URL("../act-migration/entity-apply-repository.ts", import.meta.url)),
      "utf8",
    );
    const syncRepositorySource = await readFile(
      fileURLToPath(new URL("../act-sync/sync-repository.ts", import.meta.url)),
      "utf8",
    );

    expect(repositorySource).toContain("await this.prelockTargets(");
    expect(repositorySource).toContain("await lockProfileLinkTransaction(");
    expect(entityApplySource).toContain("await lockProfileLinkTransaction(");
    expect(syncRepositorySource.match(/await lockProfileLinkTransaction\(transaction\)/g)).toHaveLength(3);
    expect(repositorySource).toContain("lock table organizations, contacts in exclusive mode");
    expect(repositorySource).toContain("lock table act_external_links in exclusive mode");
    expect(repositorySource).toContain("count(*) over() as \"totalCount\"");
    expect(repositorySource).not.toContain("limit ${evidenceBudget + 1}");
    expect(repositorySource).not.toContain("calculateRetryAt");
    expect(repositorySource).toContain("failure_attempt_count = failure_attempt_count + 1");
    expect(repositorySource).toContain("ai_provider, ai_confidence");
    expect(repositorySource).toContain("applied.provenance?.aiProvider");
    expect(repositorySource).toContain("safeEvidenceLabels(applied.evidenceLabels)");
    expect(repositorySource).toContain("evidenceLabels: effectiveResolution.evidenceLabels");
    expect(repositorySource).toContain('evidenceLabels: ["source_link"]');
    expect(repositorySource).not.toContain("safeEvidenceLabels(record.resolution.evidenceLabels)");
    expect(entityApplySource).toContain("const priorLink = await this.findPriorLink(");
    expect(entityApplySource).toContain("await this.lockPriorLink(");
    expect(entityApplySource).toMatch(
      /findPriorLink\(transaction, "organization"[\s\S]+organizations\)[\s\S]+for\("update"\)[\s\S]+lockPriorLink\([\s\S]+transaction, priorLink/,
    );
  });
});

describe("archive profile import commit-time resolution control flow", () => {
  it.each([
    {
      name: "stale AI preserve",
      candidateCount: 1,
      resolution: aiPreserveResolution,
      expected: {
        status: "linked",
        reasonCode: null,
        retryAfter: null,
        evidenceLabels: ["email"],
        provenance: undefined,
      },
    },
    {
      name: "stale provider retry",
      candidateCount: 1,
      resolution: providerRetryResolution,
      expected: {
        status: "linked",
        reasonCode: null,
        retryAfter: null,
        evidenceLabels: ["email"],
        provenance: undefined,
      },
    },
    {
      name: "AI preserve without a deterministic result",
      candidateCount: 0,
      resolution: aiPreserveResolution,
      expected: {
        status: "preserved",
        reasonCode: "ai_low_confidence",
        retryAfter: null,
        evidenceLabels: ["ai_review"],
        provenance: {
          resolutionPolicyVersion: "archive-profile-ai-v1",
          aiProvider: "openai",
          aiConfidence: "low",
        },
      },
    },
    {
      name: "provider retry without a deterministic result",
      candidateCount: 0,
      resolution: providerRetryResolution,
      expected: {
        status: "retryable_failed",
        reasonCode: "ai_unavailable",
        retryAfter: new Date("2030-01-01T00:00:00Z"),
        evidenceLabels: ["ai_unavailable"],
        provenance: {
          resolutionPolicyVersion: "archive-profile-ai-v1",
          aiProvider: "openai",
          aiConfidence: null,
        },
      },
    },
    {
      name: "AI preserve with two non-actionable exact candidates",
      candidateCount: 2,
      resolution: aiPreserveResolution,
      expected: {
        status: "preserved",
        reasonCode: "ai_low_confidence",
        retryAfter: null,
        evidenceLabels: ["ai_review"],
        provenance: {
          resolutionPolicyVersion: "archive-profile-ai-v1",
          aiProvider: "openai",
          aiConfidence: "low",
        },
      },
    },
    {
      name: "provider retry with two non-actionable exact candidates",
      candidateCount: 2,
      resolution: providerRetryResolution,
      expected: {
        status: "retryable_failed",
        reasonCode: "ai_unavailable",
        retryAfter: new Date("2030-01-01T00:00:00Z"),
        evidenceLabels: ["ai_unavailable"],
        provenance: {
          resolutionPolicyVersion: "archive-profile-ai-v1",
          aiProvider: "openai",
          aiConfidence: null,
        },
      },
    },
    {
      name: "a loaded source link that disappeared",
      candidateCount: 1,
      resolution: staleAlreadyImportedResolution,
      expectedError: "profile_source_link_stale",
    },
    {
      name: "a loaded unique match that became non-actionable ambiguity",
      candidateCount: 2,
      resolution: staleLoadedLinkResolution,
      expectedError: "archive_profile_target_set_changed",
    },
  ])("selects the final commit-time outcome for $name", async ({
    candidateCount,
    resolution,
    expected,
    expectedError,
  }) => {
    const source: ArchiveProfileSource = {
      sourceRecordId: orderedUuid(1),
      sourceVersionId: orderedUuid(2),
      streamType: "contact",
      actRecordId: "contact-act-1",
      rawSnapshot: { FirstName: "Casey", EmailAddress: "casey@example.com" },
      relationshipEvidence: {},
    };
    const targetId = orderedUuid(3);
    const candidate = {
      id: targetId,
      entityType: "contact" as const,
      exactSignals: ["email" as const],
      values: {
        firstName: "Casey",
        lastName: "Jones",
        email: "casey@example.com",
        phone: null,
        jobTitle: null,
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
      },
    };
    const repository = new DrizzleArchiveProfileImportRepository({} as typeof ApplicationDatabase);
    const internal = repository as unknown as {
      applyResolution(
        job: Record<string, unknown>,
        source: ArchiveProfileSource,
        resolution: ArchiveProfileResolution,
        previousAttemptCount: number,
        executor: { execute: ReturnType<typeof vi.fn> },
      ): Promise<{
        status: string;
        targetEntityId: string | null;
        reasonCode: string | null;
        retryAfter: Date | null;
        evidenceLabels: string[];
        provenance?: unknown;
      }>;
      exactCandidates: ReturnType<typeof vi.fn>;
      recheckTarget: ReturnType<typeof vi.fn>;
      linkContactParent: ReturnType<typeof vi.fn>;
      insertSourceLink: ReturnType<typeof vi.fn>;
      retryAt: ReturnType<typeof vi.fn>;
      createTarget: ReturnType<typeof vi.fn>;
    };
    const candidates = Array.from({ length: candidateCount }, (_, index) => ({
      ...candidate,
      id: orderedUuid(index + 3),
    }));
    internal.exactCandidates = vi.fn().mockResolvedValue(candidateCount > 0
      ? new Map([[source.sourceRecordId, candidates]])
      : new Map());
    internal.recheckTarget = vi.fn().mockResolvedValue({
      action: "link_existing",
      values: candidate.values,
      row: candidate.values,
    });
    internal.linkContactParent = vi.fn().mockResolvedValue(null);
    internal.insertSourceLink = vi.fn().mockResolvedValue(undefined);
    internal.retryAt = vi.fn().mockResolvedValue(new Date("2030-01-01T00:00:00Z"));
    internal.createTarget = vi.fn().mockResolvedValue({ id: orderedUuid(10), changedFields: [] });

    const applying = internal.applyResolution(
      { sourceDatabaseKey: databaseKey },
      source,
      resolution,
      0,
      { execute: vi.fn() },
    );
    if (expectedError) {
      await expect(applying).rejects.toMatchObject({ code: expectedError });
      return;
    }
    const applied = await applying;

    expect(applied).toMatchObject({
      ...expected,
      targetEntityId: candidateCount === 1 ? targetId : null,
    });
  });
});

async function poolConstructor() {
  const pgModuleUrl = new URL(
    "../../../../../lib/db/node_modules/pg/lib/index.js",
    import.meta.url,
  );
  const pgModule = (await import(pgModuleUrl.href)) as {
    default: {
      Pool: new (config: { connectionString: string; options: string }) => TestPool;
    };
  };
  return pgModule.default.Pool;
}

async function createHarness(): Promise<Harness> {
  const schemaName = `archive_profile_repo_${randomUUID().replaceAll("-", "")}`;
  const Pool = await poolConstructor();
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL!,
    options: `-c search_path=${schemaName},public`,
  });
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  await pool.query(`
    CREATE TABLE act_replacement_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      request_key text NOT NULL,
      source_database_key text NOT NULL,
      requested_by text NOT NULL,
      page_size integer NOT NULL DEFAULT 50,
      phase text NOT NULL DEFAULT 'extract_complete',
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (id, source_database_key)
    );
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY,
      source_database_key text NOT NULL,
      stream_type text NOT NULL,
      source_key text NOT NULL,
      act_record_id text,
      first_seen_run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
      last_seen_run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
      latest_version_id uuid,
      latest_fingerprint text,
      relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_database_key, stream_type, source_key),
      UNIQUE (id, source_database_key),
      UNIQUE (id, source_database_key, stream_type)
    );
    CREATE TABLE act_source_record_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_record_id uuid NOT NULL REFERENCES act_source_records(id),
      source_database_key text NOT NULL,
      fingerprint text NOT NULL,
      raw_snapshot jsonb NOT NULL,
      snapshot_scope text NOT NULL DEFAULT 'detail',
      observed_run_id uuid NOT NULL REFERENCES act_replacement_runs(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_record_id, fingerprint),
      UNIQUE (id, source_record_id)
    );
    ALTER TABLE act_source_records
      ADD CONSTRAINT act_source_records_latest_version_fk
      FOREIGN KEY (latest_version_id) REFERENCES act_source_record_versions(id);
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      act_record_id text UNIQUE,
      phone text,
      website text,
      act_industry text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid REFERENCES organizations(id),
      first_name text NOT NULL,
      last_name text NOT NULL,
      email text,
      phone text,
      job_title text,
      address_1 text,
      address_2 text,
      city text,
      region text,
      postal_code text,
      act_record_id text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE organization_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      contact_id uuid NOT NULL REFERENCES contacts(id),
      role text,
      is_primary boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      source text NOT NULL DEFAULT 'local',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, contact_id)
    );
    CREATE TABLE act_contact_sync_states (
      contact_id uuid PRIMARY KEY REFERENCES contacts(id),
      base_snapshot jsonb,
      act_edited_at timestamptz,
      last_synced_at timestamptz,
      local_dirty boolean NOT NULL DEFAULT false,
      state text NOT NULL DEFAULT 'unlinked',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE act_external_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      source_entity_type text NOT NULL,
      act_record_id text NOT NULL,
      source_database_key text,
      source_record_id uuid REFERENCES act_source_records(id),
      is_primary boolean NOT NULL DEFAULT false,
      sync_mode text NOT NULL DEFAULT 'pull_only',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX act_external_links_database_source_record_unique
      ON act_external_links(source_record_id) WHERE source_record_id IS NOT NULL;
    CREATE UNIQUE INDEX act_external_links_database_source_act_id_unique
      ON act_external_links(source_database_key, source_entity_type, act_record_id)
      WHERE source_database_key IS NOT NULL;
    CREATE TABLE audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type text NOT NULL,
      entity_id uuid NOT NULL,
      action text NOT NULL,
      before jsonb,
      after jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  for (const migrationName of [
    "023_act_archive_profile_import.sql",
    "023a_act_archive_profile_import_membership.sql",
    "024_act_archive_profile_import_recovery.sql",
  ]) {
    const migration = await readFile(
      fileURLToPath(new URL(`../../../../../lib/db/migrations/${migrationName}`, import.meta.url)),
      "utf8",
    );
    await pool.query(migration);
  }
  const database = drizzle(pool as never) as unknown as typeof ApplicationDatabase;
  return {
    schemaName,
    pool,
    repository: new DrizzleArchiveProfileImportRepository(database),
  };
}

async function seedRun(input: {
  sourceDatabaseKey?: string;
  requestedBy?: string;
  phase?: string;
} = {}): Promise<string> {
  const result = await harness!.pool.query<{ id: string }>(
    `INSERT INTO act_replacement_runs
       (request_key, source_database_key, requested_by, phase)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      randomUUID(),
      input.sourceDatabaseKey ?? databaseKey,
      input.requestedBy ?? owner,
      input.phase ?? "complete_with_issues",
    ],
  );
  return result.rows[0]!.id;
}

function orderedUuid(index: number): string {
  return `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

async function seedSource(input: {
  runId: string;
  index: number;
  streamType: "company" | "contact";
  raw: Record<string, unknown>;
  actRecordId?: string | null;
  relationshipEvidence?: Record<string, unknown>;
  oldVersion?: Record<string, unknown>;
}): Promise<SeededSource> {
  const sourceRecordId = orderedUuid(input.index);
  const sourceDatabaseKey = databaseKey;
  await harness!.pool.query(
    `INSERT INTO act_source_records
       (id, source_database_key, stream_type, source_key, act_record_id,
        first_seen_run_id, last_seen_run_id, relationship_evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7::jsonb)`,
    [
      sourceRecordId,
      sourceDatabaseKey,
      input.streamType,
      `${input.streamType}-${input.index}`,
      input.actRecordId === undefined ? `${input.streamType}-act-${input.index}` : input.actRecordId,
      input.runId,
      JSON.stringify(input.relationshipEvidence ?? {}),
    ],
  );
  if (input.oldVersion) {
    await harness!.pool.query(
      `INSERT INTO act_source_record_versions
         (source_record_id, source_database_key, fingerprint, raw_snapshot, observed_run_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [sourceRecordId, sourceDatabaseKey, `old-${input.index}`, JSON.stringify(input.oldVersion), input.runId],
    );
  }
  const version = await harness!.pool.query<{ id: string }>(
    `INSERT INTO act_source_record_versions
       (source_record_id, source_database_key, fingerprint, raw_snapshot, observed_run_id)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [sourceRecordId, sourceDatabaseKey, `latest-${input.index}`, JSON.stringify(input.raw), input.runId],
  );
  const sourceVersionId = version.rows[0]!.id;
  await harness!.pool.query(
    `UPDATE act_source_records
     SET latest_version_id = $1, latest_fingerprint = $2 WHERE id = $3`,
    [sourceVersionId, `latest-${input.index}`, sourceRecordId],
  );
  return {
    sourceRecordId,
    sourceVersionId,
    source: {
      sourceRecordId,
      sourceVersionId,
      streamType: input.streamType,
      actRecordId: input.actRecordId === undefined
        ? `${input.streamType}-act-${input.index}`
        : input.actRecordId,
      rawSnapshot: input.raw,
      relationshipEvidence: input.relationshipEvidence ?? {},
    },
  };
}

async function createAndClaim(runId: string): Promise<ClaimedArchiveProfileJob> {
  await harness!.repository.createOrGetJob({
    runId,
    sourceDatabaseKey: databaseKey,
    requestKey: randomUUID(),
    requestedBy: owner,
    now: now(),
  });
  const claim = await harness!.repository.claimNext({ workerId: randomUUID(), now: now() });
  expect(claim).not.toBeNull();
  return claim!;
}

async function count(table: string): Promise<number> {
  const result = await harness!.pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return result.rows[0]!.count;
}

repositoryTests("archive profile import repository", () => {
  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    if (!harness) return;
    await harness.pool.query(`DROP SCHEMA IF EXISTS "${harness.schemaName}" CASCADE`);
    await harness.pool.end();
    harness = undefined;
  });

  it("returns the same job when the start request is replayed", async () => {
    const runId = await seedRun();
    await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Replay Co" } });
    const input = {
      runId,
      sourceDatabaseKey: databaseKey,
      requestKey: "start-replay",
      requestedBy: owner,
      now: now(),
    };

    const first = await harness!.repository.createOrGetJob(input);
    const replay = await harness!.repository.createOrGetJob(input);

    expect(replay).toEqual(first);
    expect(await count("act_archive_profile_import_jobs")).toBe(1);
  });

  it("returns the existing run job for a second request key", async () => {
    const runId = await seedRun();
    const first = await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "first", requestedBy: owner, now: now(),
    });
    const second = await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "second", requestedBy: owner, now: now(),
    });

    expect(second.jobId).toBe(first.jobId);
    expect(await count("act_archive_profile_import_jobs")).toBe(1);
  });

  it("reactivates failed work from frozen company retries without resetting durable progress", async () => {
    const runId = await seedRun();
    const first = await seedSource({
      runId, index: 1, streamType: "company", raw: { Name: "Committed Co" },
    });
    const retry = await seedSource({
      runId, index: 2, streamType: "company", raw: { Name: "Retry Co" },
    });
    await seedSource({
      runId, index: 3, streamType: "contact", raw: { FirstName: "Casey", LastName: "Later" },
    });
    const original = await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "original-start", requestedBy: owner, now: now(),
    });
    await harness!.pool.query(
      `INSERT INTO act_archive_profile_import_results
        (job_id, source_record_id, source_version_id, status, reason_code,
         resolution_policy_version, evidence_labels, attempt_count, retry_after)
       VALUES ($1, $2, $3, 'preserved', 'unsupported_record', 'archive-profile-v1', '[]', 1, NULL),
              ($1, $4, $5, 'retryable_failed', 'ai_timeout', 'archive-profile-v1', '[]', 2,
               clock_timestamp() + interval '5 minutes')`,
      [original.jobId, first.sourceRecordId, first.sourceVersionId,
        retry.sourceRecordId, retry.sourceVersionId],
    );
    await harness!.pool.query(
      `UPDATE act_archive_profile_import_jobs
       SET phase = 'failed', cursor_source_record_id = $2,
           processed_count = 2, preserved_count = 1, retryable_failure_count = 1,
           last_error_code = 'archive_profile_database_unavailable',
           failure_attempt_count = 4, completed_at = clock_timestamp()
       WHERE id = $1`,
      [original.jobId, retry.sourceRecordId],
    );
    const membershipBefore = await harness!.pool.query(
      `SELECT source_record_id::text, source_version_id::text, phase
       FROM act_archive_profile_import_sources WHERE job_id = $1 ORDER BY source_record_id`,
      [original.jobId],
    );
    const resultsBefore = await harness!.pool.query(
      `SELECT source_record_id::text, source_version_id::text, status, reason_code,
              attempt_count, retry_after
       FROM act_archive_profile_import_results WHERE job_id = $1 ORDER BY source_record_id`,
      [original.jobId],
    );

    const [reactivated, duplicate] = await Promise.all([
      harness!.repository.createOrGetJob({
        runId, sourceDatabaseKey: databaseKey, requestKey: "retry-one", requestedBy: owner, now: now(),
      }),
      harness!.repository.createOrGetJob({
        runId, sourceDatabaseKey: databaseKey, requestKey: "retry-two", requestedBy: owner, now: now(),
      }),
    ]);

    expect(reactivated).toMatchObject({
      jobId: original.jobId,
      phase: "companies",
      active: true,
      processedCount: 2,
      preservedCount: 1,
      retryableFailureCount: 1,
      lastErrorCode: null,
    });
    expect(duplicate).toEqual(reactivated);
    expect((await harness!.pool.query(
      `SELECT source_record_id::text, source_version_id::text, phase
       FROM act_archive_profile_import_sources WHERE job_id = $1 ORDER BY source_record_id`,
      [original.jobId],
    )).rows).toEqual(membershipBefore.rows);
    expect((await harness!.pool.query(
      `SELECT source_record_id::text, source_version_id::text, status, reason_code,
              attempt_count, retry_after
       FROM act_archive_profile_import_results WHERE job_id = $1 ORDER BY source_record_id`,
      [original.jobId],
    )).rows).toEqual(resultsBefore.rows);
    const job = await harness!.pool.query<{
      request_key: string;
      cursor_source_record_id: string | null;
      retry_after: Date | null;
      lease_token: string | null;
      last_error_code: string | null;
      failure_attempt_count: number;
    }>(
      `SELECT request_key, cursor_source_record_id, retry_after, lease_token,
              last_error_code, failure_attempt_count
       FROM act_archive_profile_import_jobs WHERE id = $1`,
      [original.jobId],
    );
    expect(job.rows[0]).toEqual({
      request_key: "original-start",
      cursor_source_record_id: null,
      retry_after: null,
      lease_token: null,
      last_error_code: null,
      failure_attempt_count: 0,
    });
    await expect(
      harness!.repository.claimNext({ workerId: "retry-worker", now: now() }),
    ).resolves.toMatchObject({ jobId: original.jobId, phase: "companies" });
  });

  it("reactivates failed work in contacts after all frozen companies are terminal", async () => {
    const runId = await seedRun();
    const company = await seedSource({
      runId, index: 1, streamType: "company", raw: { Name: "Done Co" },
    });
    await seedSource({
      runId, index: 2, streamType: "contact", raw: { FirstName: "Casey", LastName: "Pending" },
    });
    const original = await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "contact-start", requestedBy: owner, now: now(),
    });
    await harness!.pool.query(
      `INSERT INTO act_archive_profile_import_results
        (job_id, source_record_id, source_version_id, status, reason_code,
         resolution_policy_version, evidence_labels, attempt_count)
       VALUES ($1, $2, $3, 'preserved', 'unsupported_record', 'archive-profile-v1', '[]', 1)`,
      [original.jobId, company.sourceRecordId, company.sourceVersionId],
    );
    await harness!.pool.query(
      `UPDATE act_archive_profile_import_jobs
       SET phase = 'failed', processed_count = 1, preserved_count = 1,
           last_error_code = 'archive_profile_database_unavailable', completed_at = clock_timestamp()
       WHERE id = $1`,
      [original.jobId],
    );

    const reactivated = await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "contact-retry", requestedBy: owner, now: now(),
    });

    expect(reactivated).toMatchObject({
      phase: "contacts", active: true, processedCount: 1, preservedCount: 1,
      lastErrorCode: null,
    });
  });

  it("does not reactivate a failed row while its lease is still live", async () => {
    const runId = await seedRun();
    await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Leased Co" } });
    const original = await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "lease-start", requestedBy: owner, now: now(),
    });
    const leaseToken = randomUUID();
    await harness!.pool.query(
      `UPDATE act_archive_profile_import_jobs
       SET phase = 'failed', lease_owner = 'live-worker', lease_token = $2,
           lease_expires_at = clock_timestamp() + interval '5 minutes',
           last_error_code = 'archive_profile_database_unavailable'
       WHERE id = $1`,
      [original.jobId, leaseToken],
    );

    const replay = await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "lease-retry", requestedBy: owner, now: now(),
    });

    expect(replay).toMatchObject({ phase: "failed", active: false });
    const lease = await harness!.pool.query<{ lease_token: string; lease_owner: string }>(
      `SELECT lease_token, lease_owner FROM act_archive_profile_import_jobs WHERE id = $1`,
      [original.jobId],
    );
    expect(lease.rows[0]).toEqual({ lease_token: leaseToken, lease_owner: "live-worker" });
  });

  it("claims only queued work or an expired lease", async () => {
    const runId = await seedRun();
    await harness!.repository.createOrGetJob({
      runId, sourceDatabaseKey: databaseKey, requestKey: "claim", requestedBy: owner, now: now(),
    });
    const first = await harness!.repository.claimNext({ workerId: "worker-1", now: now() });
    expect(first).not.toBeNull();
    await harness!.pool.query(
      `UPDATE act_archive_profile_import_jobs SET lease_expires_at = $1 WHERE id = $2`,
      [new Date(Date.now() - 1_000), first!.jobId],
    );

    const recovered = await harness!.repository.claimNext({ workerId: "worker-2", now: now() });

    expect(recovered).toMatchObject({ jobId: first!.jobId });
    expect(recovered!.leaseToken).not.toBe(first!.leaseToken);
  });

  it("never steals an unexpired lease", async () => {
    const runId = await seedRun();
    const first = await createAndClaim(runId);

    const stolen = await harness!.repository.claimNext({ workerId: "worker-2", now: now() });

    expect(stolen).toBeNull();
    const lease = await harness!.pool.query<{ lease_token: string }>(
      `SELECT lease_token FROM act_archive_profile_import_jobs WHERE id = $1`,
      [first.jobId],
    );
    expect(lease.rows[0]!.lease_token).toBe(first.leaseToken);
  });

  it("serializes a not-yet-local ACT contact pull with archive profile mutations", async () => {
    const database = drizzle(harness!.pool as never) as unknown as typeof ApplicationDatabase;
    const syncRepository = new DrizzleSyncRepository(database);
    const blocker = await harness!.pool.connect();
    let pull: Promise<string> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select pg_advisory_xact_lock(hashtext('adventure-zone:act-profile-link-mutations:v1'))",
      );
      pull = syncRepository.pullContact({
        rowId: "new-act-contact",
        category: "new_in_act",
        matchReason: "none",
        localContactId: null,
        actRecordId: "sync-contact-1",
        candidateLocalContactIds: [],
        candidateActRecordIds: [],
        baseSnapshot: null,
        localSnapshot: null,
        actSnapshot: null,
        actEditedAt: null,
        allowedDecisions: ["pull"],
        messages: [],
      }, {
        id: "sync-contact-1",
        firstName: "New",
        lastName: "Contact",
        organizationName: null,
        jobTitle: null,
        email: "new-contact@example.com",
        phone: null,
        address1: null,
        address2: null,
        city: null,
        region: null,
        postalCode: null,
        editedAt: null,
      });

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const locks = await harness!.pool.query<{ waiting: boolean }>(`select exists (
          select 1 from pg_locks where locktype = 'advisory' and not granted
        ) as waiting`);
        waiting = locks.rows[0]?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await blocker.query("commit");
      const contactId = await pull;
      const persisted = await harness!.pool.query<{ contacts: number; links: number }>(`select
        (select count(*)::int from contacts where id = $1) as contacts,
        (select count(*)::int from act_external_links
          where entity_type = 'contact' and entity_id = $1 and act_record_id = 'sync-contact-1') as links`,
      [contactId]);
      expect(persisted.rows[0]).toEqual({ contacts: 1, links: 1 });
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      blocker.release();
      await pull?.catch(() => undefined);
    }
  });

  it("loads exactly 50 latest company versions after the cursor", async () => {
    const runId = await seedRun();
    for (let index = 1; index <= 51; index += 1) {
      await seedSource({
        runId,
        index,
        streamType: "company",
        raw: { Name: `Latest ${index}` },
        oldVersion: { Name: `Old ${index}` },
      });
    }
    const claim = await createAndClaim(runId);

    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });

    expect(batch).toHaveLength(50);
    expect(batch.map(({ source }) => source.sourceRecordId)).toEqual(
      Array.from({ length: 50 }, (_, index) => orderedUuid(index + 1)),
    );
    expect(batch.map(({ source }) => source.rawSnapshot.Name)).toEqual(
      Array.from({ length: 50 }, (_, index) => `Latest ${index + 1}`),
    );
  });

  it("advances from companies to contacts without changing the replacement run phase", async () => {
    const runId = await seedRun({ phase: "complete_with_issues" });
    const seeded = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Phase Co" } });
    const claim = await createAndClaim(runId);
    const resolution = resolveArchiveProfile({ source: seeded.source, candidates: [], linkedTarget: null });

    const committed = await harness!.repository.commitBatch({
      ...claim,
      records: [{ source: seeded.source, resolution }],
      now: now(),
    });

    expect(committed).toMatchObject({ phaseAdvanced: true, status: { phase: "contacts" } });
    const run = await harness!.pool.query<{ phase: string }>(
      `SELECT phase FROM act_replacement_runs WHERE id = $1`,
      [runId],
    );
    expect(run.rows[0]!.phase).toBe("complete_with_issues");
  });

  it("atomically creates a profile, source link, result, counters, and cursor", async () => {
    const runId = await seedRun();
    const first = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Atomic Co", Phone: "555-0100" } });
    const claim = await createAndClaim(runId);
    const resolution = resolveArchiveProfile({ source: first.source, candidates: [], linkedTarget: null });

    const committed = await harness!.repository.commitBatch({
      ...claim,
      records: [{ source: first.source, resolution }],
      now: now(),
    });

    expect(committed).toMatchObject({
      phaseAdvanced: true,
      status: { processedCount: 1, createdCount: 1, phase: "contacts" },
    });
    const written = await harness!.pool.query<{
      profiles: number; links: number; results: number; audits: number; cursor: string;
    }>(`SELECT
      (SELECT count(*)::int FROM organizations organization
         JOIN act_external_links link ON link.entity_id = organization.id
         WHERE link.source_record_id = $2) AS profiles,
      (SELECT count(*)::int FROM act_external_links WHERE source_record_id = $2
         AND source_database_key = $3 AND is_primary AND sync_mode = 'pull_only') AS links,
      (SELECT count(*)::int FROM act_archive_profile_import_results
         WHERE source_record_id = $2 AND source_version_id = $4 AND status = 'created') AS results,
      (SELECT count(*)::int FROM audit_entries WHERE action = 'act_archive_profile_imported') AS audits,
      (SELECT cursor_source_record_id::text FROM act_archive_profile_import_jobs WHERE id = $5) AS cursor`, [
      first.source.actRecordId,
      first.sourceRecordId,
      databaseKey,
      first.sourceVersionId,
      claim.jobId,
    ]);
    expect(written.rows[0]).toEqual({
      profiles: 1, links: 1, results: 1, audits: 1, cursor: null,
    });
  });

  it.each([
    {
      name: "AI preserve",
      resolution: aiPreserveResolution,
    },
    {
      name: "provider retry",
      resolution: providerRetryResolution,
    },
  ])("re-resolves stale $name when an exact contact appears before commit", async ({ resolution }) => {
    const runId = await seedRun();
    const contact = await seedSource({
      runId,
      index: 1,
      streamType: "contact",
      raw: { FirstName: "Casey", EmailAddress: "casey@example.com" },
    });
    const companyClaim = await createAndClaim(runId);
    await harness!.repository.commitBatch({ ...companyClaim, records: [], now: now() });
    const contactClaim = await harness!.repository.claimNext({ workerId: randomUUID(), now: now() });
    expect(contactClaim).not.toBeNull();
    const batch = await harness!.repository.loadBatch({ ...contactClaim!, limit: 50 });
    expect(batch).toHaveLength(1);
    expect(batch[0]!.candidates).toEqual([]);
    expect(resolveArchiveProfile(batch[0]!)).toMatchObject({ action: "needs_ai" });
    const target = await harness!.pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email)
       VALUES ('Casey', 'Jones', 'casey@example.com') RETURNING id`,
    );

    await harness!.repository.commitBatch({
      ...contactClaim!,
      records: [{ source: batch[0]!.source, resolution }],
      now: now(),
    });

    const result = await harness!.pool.query<{
      status: string;
      target_entity_id: string;
      reason_code: string | null;
      resolution_policy_version: string;
      ai_provider: string | null;
      ai_confidence: string | null;
      evidence_labels: string[];
      retry_after: Date | null;
    }>(
      `SELECT status, target_entity_id, reason_code, resolution_policy_version,
          ai_provider, ai_confidence, evidence_labels, retry_after
       FROM act_archive_profile_import_results WHERE source_record_id = $1`,
      [contact.sourceRecordId],
    );
    expect(result.rows[0]).toEqual({
      status: "linked",
      target_entity_id: target.rows[0]!.id,
      reason_code: null,
      resolution_policy_version: "archive-profile-resolution-v1",
      ai_provider: null,
      ai_confidence: null,
      evidence_labels: ["email"],
      retry_after: null,
    });
    const link = await harness!.pool.query<{ entity_id: string }>(
      `SELECT entity_id FROM act_external_links WHERE source_record_id = $1`,
      [contact.sourceRecordId],
    );
    expect(link.rows).toEqual([{ entity_id: target.rows[0]!.id }]);
    expect(await count("contacts")).toBe(1);
  });

  it.each([
    {
      name: "AI preserve",
      resolution: aiPreserveResolution,
      expected: {
        status: "preserved",
        reason_code: "ai_low_confidence",
        ai_confidence: "low",
        evidence_labels: ["ai_review"],
        attempt_count: 0,
      },
      retryExpected: false,
    },
    {
      name: "provider retry",
      resolution: providerRetryResolution,
      expected: {
        status: "retryable_failed",
        reason_code: "ai_unavailable",
        ai_confidence: null,
        evidence_labels: ["ai_unavailable"],
        attempt_count: 1,
      },
      retryExpected: true,
    },
  ])("retains $name when two new exact contacts cannot produce an actionable create", async ({
    resolution,
    expected,
    retryExpected,
  }) => {
    const runId = await seedRun();
    const contact = await seedSource({
      runId,
      index: 1,
      streamType: "contact",
      raw: { FirstName: "Casey", EmailAddress: "casey@example.com" },
    });
    const companyClaim = await createAndClaim(runId);
    await harness!.repository.commitBatch({ ...companyClaim, records: [], now: now() });
    const contactClaim = await harness!.repository.claimNext({ workerId: randomUUID(), now: now() });
    const batch = await harness!.repository.loadBatch({ ...contactClaim!, limit: 50 });
    expect(batch[0]!.candidates).toEqual([]);
    expect(resolveArchiveProfile(batch[0]!)).toMatchObject({ action: "needs_ai" });
    await harness!.pool.query(
      `INSERT INTO contacts (first_name, last_name, email)
       VALUES ('Casey', 'One', 'casey@example.com'), ('Casey', 'Two', 'casey@example.com')`,
    );

    await expect(harness!.repository.commitBatch({
      ...contactClaim!,
      records: [{ source: batch[0]!.source, resolution }],
      now: now(),
    })).resolves.toBeDefined();

    const result = await harness!.pool.query<{
      status: string;
      reason_code: string | null;
      resolution_policy_version: string;
      ai_provider: string | null;
      ai_confidence: string | null;
      evidence_labels: string[];
      attempt_count: number;
      retry_after: Date | null;
    }>(
      `SELECT status, reason_code, resolution_policy_version, ai_provider,
          ai_confidence, evidence_labels, attempt_count, retry_after
       FROM act_archive_profile_import_results WHERE source_record_id = $1`,
      [contact.sourceRecordId],
    );
    expect(result.rows[0]).toMatchObject({
      ...expected,
      resolution_policy_version: "archive-profile-ai-v1",
      ai_provider: "openai",
    });
    expect(result.rows[0]!.retry_after instanceof Date).toBe(retryExpected);
    expect(await count("contacts")).toBe(2);
    expect(await count("act_external_links")).toBe(0);
  });

  it("rejects a loaded already-imported decision when its scoped link disappears before commit", async () => {
    const runId = await seedRun();
    const source = await seedSource({
      runId,
      index: 1,
      streamType: "company",
      raw: { Name: "Vanishing Link" },
    });
    const target = await harness!.pool.query<{ id: string }>(
      `INSERT INTO organizations (name) VALUES ('Vanishing Link') RETURNING id`,
    );
    await harness!.pool.query(
      `INSERT INTO act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id,
         source_database_key, source_record_id, is_primary, sync_mode)
       VALUES ('organization', $1, 'company', $2, $3, $4, true, 'pull_only')`,
      [target.rows[0]!.id, source.source.actRecordId, databaseKey, source.sourceRecordId],
    );
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    const loadedResolution = resolveArchiveProfile(batch[0]!);
    expect(loadedResolution).toMatchObject({
      action: "already_imported",
      targetEntityId: target.rows[0]!.id,
    });
    await harness!.pool.query(`DELETE FROM act_external_links WHERE source_record_id = $1`, [
      source.sourceRecordId,
    ]);

    await expect(harness!.repository.commitBatch({
      ...claim,
      records: [{ source: batch[0]!.source, resolution: loadedResolution }],
      now: now(),
    })).rejects.toMatchObject({ code: "profile_source_link_stale" });

    expect(await count("organizations")).toBe(1);
    expect(await count("act_external_links")).toBe(0);
    expect(await count("act_archive_profile_import_results")).toBe(0);
  });

  it("replays a committed source as already imported without another profile", async () => {
    const runId = await seedRun();
    const first = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Replay Target" } });
    const claim = await createAndClaim(runId);
    const create = resolveArchiveProfile({ source: first.source, candidates: [], linkedTarget: null });
    await harness!.repository.commitBatch({ ...claim, records: [{ source: first.source, resolution: create }], now: now() });
    const replayRunId = await seedRun();
    const replayClaim = await createAndClaim(replayRunId);
    expect(replayClaim).not.toBeNull();
    const replayBatch = await harness!.repository.loadBatch({ ...replayClaim!, limit: 50 });
    const replayResolution = resolveArchiveProfile(replayBatch[0]!);
    expect(replayResolution).toMatchObject({ action: "already_imported" });
    const originalProfileCount = await count("organizations");

    const replay = await harness!.repository.commitBatch({
      ...replayClaim!,
      records: [{ source: replayBatch[0]!.source, resolution: replayResolution }],
      now: now(),
    });

    expect(await count("organizations")).toBe(originalProfileCount);
    expect(replay.status).toMatchObject({
      processedCount: 1,
      createdCount: 0,
      alreadyImportedCount: 1,
    });
  });

  it("creates an ambiguous source separately", async () => {
    const runId = await seedRun();
    await harness!.pool.query(
      `INSERT INTO organizations (name, city, region) VALUES ('Orbit Music', 'Austin', 'TX')`,
    );
    const seeded = await seedSource({
      runId,
      index: 1,
      streamType: "company",
      raw: { Name: "Orbit Music", Address: { City: "Austin", State: "TX" } },
    });
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    const resolution: ArchiveProfileResolution = {
      action: "create_profile",
      targetEntityType: "organization",
      values: { name: "Orbit Music", city: "Austin", region: "TX" },
      evidenceLabels: ["ambiguous_exact_match"],
    };
    expect(batch[0]!.candidates).toHaveLength(1);

    await harness!.repository.commitBatch({
      ...claim, records: [{ source: seeded.source, resolution }], now: now(),
    });

    expect(await count("organizations")).toBe(2);
  });

  it("updates supported fields with ACT values but does not erase with null", async () => {
    const runId = await seedRun();
    const local = await harness!.pool.query<{ id: string }>(
      `INSERT INTO organizations (name, city, region, phone, website)
       VALUES ('Field Co', 'Austin', 'TX', 'old-phone', 'keep.example') RETURNING id`,
    );
    const seeded = await seedSource({
      runId,
      index: 1,
      streamType: "company",
      raw: { Name: "Field Co", Phone: "new-phone", Address: { City: "Austin", State: "TX" } },
    });
    await seedSource({ runId, index: 2, streamType: "company", raw: { Name: "Later" } });
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    const resolution: ArchiveProfileResolution = {
      action: "update_existing",
      targetEntityType: "organization",
      targetEntityId: local.rows[0]!.id,
      values: { name: "Field Co", city: "Austin", region: "TX", phone: "new-phone", website: null },
      evidenceLabels: ["company_name_and_location"],
    };
    expect(batch[0]!.candidates).toEqual([
      expect.objectContaining({ id: local.rows[0]!.id, exactSignals: ["company_name_and_location"] }),
    ]);

    await harness!.repository.commitBatch({
      ...claim, records: [{ source: seeded.source, resolution }], now: now(),
    });

    const updated = await harness!.pool.query<{ phone: string; website: string }>(
      `SELECT phone, website FROM organizations WHERE id = $1`,
      [local.rows[0]!.id],
    );
    expect(updated.rows[0]).toEqual({ phone: "new-phone", website: "keep.example" });
  });

  it("imports a contact without a missing company relationship", async () => {
    const runId = await seedRun();
    const contact = await seedSource({
      runId,
      index: 1,
      streamType: "contact",
      raw: { FirstName: "Standalone", LastName: "Contact" },
      relationshipEvidence: { parentCompanyActRecordId: "missing-company" },
    });
    const claim = await createAndClaim(runId);
    await harness!.repository.commitBatch({ ...claim, records: [], now: now() });
    const contactClaim = await harness!.repository.claimNext({ workerId: "contacts", now: now() });
    expect(contactClaim).not.toBeNull();
    const resolution = resolveArchiveProfile({ source: contact.source, candidates: [], linkedTarget: null });

    await harness!.repository.commitBatch({
      ...contactClaim!, records: [{ source: contact.source, resolution }], now: now(),
    });

    const imported = await harness!.pool.query<{ organization_id: string | null }>(
      `SELECT organization_id FROM contacts WHERE act_record_id = $1`,
      [contact.source.actRecordId],
    );
    expect(imported.rows[0]!.organization_id).toBeNull();
    expect(await count("organization_contacts")).toBe(0);
  });

  it("attaches a contact only after its archived company relationship resolves", async () => {
    const runId = await seedRun();
    const company = await seedSource({
      runId, index: 1, streamType: "company", raw: { Name: "Resolved Parent" },
    });
    const contact = await seedSource({
      runId, index: 2, streamType: "contact", raw: { FirstName: "Related", LastName: "Contact" },
    });
    const relationshipId = orderedUuid(3);
    await harness!.pool.query(
      `INSERT INTO act_source_records
         (id, source_database_key, stream_type, source_key, act_record_id,
          first_seen_run_id, last_seen_run_id, relationship_evidence)
       VALUES ($1, $2, 'company_contact', 'relationship-3', NULL, $3, $3, $4::jsonb)`,
      [relationshipId, databaseKey, runId, JSON.stringify({
        parentKind: "contact",
        parentActRecordId: contact.source.actRecordId,
        targetKind: "company",
        targetActRecordId: company.source.actRecordId,
      })],
    );
    const relationshipVersion = await harness!.pool.query<{ id: string }>(
      `INSERT INTO act_source_record_versions
         (source_record_id, source_database_key, fingerprint, raw_snapshot, observed_run_id)
       VALUES ($1, $2, 'relationship-latest-3', '{}'::jsonb, $3) RETURNING id`,
      [relationshipId, databaseKey, runId],
    );
    await harness!.pool.query(
      `UPDATE act_source_records SET latest_version_id = $1, latest_fingerprint = 'relationship-latest-3'
       WHERE id = $2`,
      [relationshipVersion.rows[0]!.id, relationshipId],
    );
    const companyClaim = await createAndClaim(runId);
    const companyResolution = resolveArchiveProfile({ source: company.source, candidates: [], linkedTarget: null });
    await harness!.repository.commitBatch({
      ...companyClaim, records: [{ source: company.source, resolution: companyResolution }], now: now(),
    });
    const contactClaim = await harness!.repository.claimNext({ workerId: "relationship", now: now() });
    expect(contactClaim).not.toBeNull();
    const batch = await harness!.repository.loadBatch({ ...contactClaim!, limit: 50 });
    expect(batch[0]!.source.relationshipEvidence).toMatchObject({
      companyActRecordIds: [company.source.actRecordId],
    });
    const contactResolution = resolveArchiveProfile(batch[0]!);

    await harness!.repository.commitBatch({
      ...contactClaim!, records: [{ source: batch[0]!.source, resolution: contactResolution }], now: now(),
    });

    const relationship = await harness!.pool.query<{
      organization_id: string;
      contact_organization_id: string;
    }>(`SELECT relation.organization_id, contact.organization_id AS contact_organization_id
        FROM organization_contacts relation
        JOIN contacts contact ON contact.id = relation.contact_id`);
    expect(relationship.rows[0]!.contact_organization_id).toBe(relationship.rows[0]!.organization_id);
  });

  it("rejects an omitted, reordered, or substituted member without advancing the job", async () => {
    const runId = await seedRun();
    const sources = await Promise.all(Array.from({ length: 50 }, (_, index) => seedSource({
      runId,
      index: index + 1,
      streamType: "company",
      raw: { Name: `Bound ${index + 1}` },
    })));
    const claim = await createAndClaim(runId);
    const last = sources[49]!;
    await expect(harness!.repository.commitBatch({
      ...claim,
      records: [{
        source: last.source,
        resolution: resolveArchiveProfile({ source: last.source, candidates: [], linkedTarget: null }),
      }],
      now: now(),
    })).rejects.toMatchObject({ code: "archive_profile_batch_mismatch" });
    const job = await harness!.pool.query<{ processed_count: number; cursor_source_record_id: string | null }>(
      `SELECT processed_count, cursor_source_record_id FROM act_archive_profile_import_jobs WHERE id = $1`,
      [claim.jobId],
    );
    expect(job.rows[0]).toEqual({ processed_count: 0, cursor_source_record_id: null });
  });

  it("freezes job membership and source versions at job creation", async () => {
    const runId = await seedRun();
    const frozen = await seedSource({ runId, index: 10, streamType: "company", raw: { Name: "Frozen" } });
    const claim = await createAndClaim(runId);
    const replacement = await harness!.pool.query<{ id: string }>(
      `INSERT INTO act_source_record_versions
        (source_record_id, source_database_key, fingerprint, raw_snapshot, observed_run_id)
       VALUES ($1, $2, 'replacement', '{"Name":"Changed"}'::jsonb, $3) RETURNING id`,
      [frozen.sourceRecordId, databaseKey, runId],
    );
    await harness!.pool.query(`UPDATE act_source_records SET latest_version_id = $1 WHERE id = $2`, [
      replacement.rows[0]!.id,
      frozen.sourceRecordId,
    ]);
    await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Too Late" } });
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    expect(batch.map(({ source }) => [source.sourceRecordId, source.sourceVersionId])).toEqual([
      [frozen.sourceRecordId, frozen.sourceVersionId],
    ]);
  });

  it("uses database time for claims and fences a commit whose lease expires in-flight", async () => {
    const runId = await seedRun();
    await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Lease Fence" } });
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    await harness!.pool.query(
      `UPDATE act_archive_profile_import_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [claim.jobId],
    );
    await expect(harness!.repository.commitBatch({
      ...claim,
      records: batch.map((context) => ({ source: context.source, resolution: resolveArchiveProfile(context) })),
      now: new Date("2999-01-01T00:00:00Z"),
    })).rejects.toMatchObject({ code: "archive_profile_lease_lost" });
    expect(await count("organizations")).toBe(0);
  });

  it("links a unique exact target with an occupied primary slot as a secondary source", async () => {
    const runId = await seedRun();
    const first = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Shared Name" }, actRecordId: "global-collision" });
    const occupied = await harness!.pool.query<{ id: string }>(
      `INSERT INTO organizations (name, act_record_id) VALUES ('Shared Name', 'global-collision') RETURNING id`,
    );
    await harness!.pool.query(
      `INSERT INTO act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id, is_primary, sync_mode)
       VALUES ('organization', $1, 'company', 'legacy-primary', true, 'pull_only')`,
      [occupied.rows[0]!.id],
    );
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    await harness!.repository.commitBatch({
      ...claim,
      records: [{ source: first.source, resolution: resolveArchiveProfile(batch[0]!) }],
      now: now(),
    });
    const created = await harness!.pool.query<{ count: number; global_ids: number; source_primary: boolean }>(
      `SELECT count(*)::int AS count, count(act_record_id)::int AS global_ids,
         (SELECT is_primary FROM act_external_links WHERE source_record_id = $1) AS source_primary
       FROM organizations`,
      [first.sourceRecordId],
    );
    expect(created.rows[0]).toEqual({ count: 1, global_ids: 1, source_primary: false });
  });

  it("keeps multiple exact matches ambiguous even when one primary slot is occupied", async () => {
    const runId = await seedRun();
    const source = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Still Ambiguous" } });
    const targets = await harness!.pool.query<{ id: string }>(
      `INSERT INTO organizations (name) VALUES ('Still Ambiguous'), ('Still Ambiguous') RETURNING id`,
    );
    await harness!.pool.query(
      `INSERT INTO act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id, is_primary, sync_mode)
       VALUES ('organization', $1, 'company', 'occupied', true, 'pull_only')`,
      [targets.rows[0]!.id],
    );
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    expect(batch[0]!.candidates).toHaveLength(2);
    await harness!.repository.commitBatch({
      ...claim,
      records: [{ source: source.source, resolution: resolveArchiveProfile(batch[0]!) }],
      now: now(),
    });
    expect(await count("organizations")).toBe(3);
  });

  it("does not deadlock with target-before-link entity apply ordering", async () => {
    const runId = await seedRun();
    const source = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Shared Lock" } });
    const target = await harness!.pool.query<{ id: string }>(
      `INSERT INTO organizations (name) VALUES ('Shared Lock') RETURNING id`,
    );
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    const entityClient = await harness!.pool.connect();
    try {
      await entityClient.query("BEGIN");
      await entityClient.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [target.rows[0]!.id]);
      const archiveCommit = harness!.repository.commitBatch({
        ...claim,
        records: [{ source: source.source, resolution: resolveArchiveProfile(batch[0]!) }],
        now: now(),
      });
      let archiveBarrierWaiting = false;
      for (let attempt = 0; attempt < 100 && !archiveBarrierWaiting; attempt += 1) {
        const waiting = await harness!.pool.query<{ waiting: boolean }>(
          `select exists (
             select 1 from pg_locks lock
             join pg_class relation on relation.oid = lock.relation
             join pg_namespace namespace on namespace.oid = relation.relnamespace
             where namespace.nspname = $1 and relation.relname = 'organizations'
               and lock.mode = 'ExclusiveLock' and not lock.granted
           ) as waiting`,
          [harness!.schemaName],
        );
        archiveBarrierWaiting = waiting.rows[0]?.waiting === true;
        if (!archiveBarrierWaiting) await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(archiveBarrierWaiting).toBe(true);
      await entityClient.query(
        `UPDATE organizations SET phone = '555-0199' WHERE id = $1`,
        [target.rows[0]!.id],
      );
      await entityClient.query(
        `INSERT INTO act_external_links
          (entity_type, entity_id, source_entity_type, act_record_id, is_primary, sync_mode)
         VALUES ('organization', $1, 'company', 'entity-apply-primary', true, 'pull_only')`,
        [target.rows[0]!.id],
      );
      await entityClient.query("COMMIT");
      await expect(Promise.race([
        archiveCommit,
        new Promise((_, reject) => setTimeout(() => reject(new Error("deadlock timeout")), 2_000)),
      ])).resolves.toBeDefined();
    } finally {
      await entityClient.query("ROLLBACK").catch(() => undefined);
      entityClient.release();
    }
  });

  it("rechecks exact-match cardinality transactionally before linking", async () => {
    const runId = await seedRun();
    await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Concurrent Match", City: "Austin" } });
    await harness!.pool.query(`INSERT INTO organizations (name, city) VALUES ('Concurrent Match', 'Austin')`);
    const claim = await createAndClaim(runId);
    const batch = await harness!.repository.loadBatch({ ...claim, limit: 50 });
    expect(batch[0]!.candidates).toHaveLength(1);
    await harness!.pool.query(`INSERT INTO organizations (name, city) VALUES ('Concurrent Match', 'Austin')`);
    await harness!.repository.commitBatch({
      ...claim,
      records: [{ source: batch[0]!.source, resolution: resolveArchiveProfile(batch[0]!) }],
      now: now(),
    });
    expect(await count("organizations")).toBe(3);
  });

  it("retries when an identity-incomplete unique contact match becomes ambiguous before commit", async () => {
    const runId = await seedRun();
    await seedSource({
      runId,
      index: 1,
      streamType: "contact",
      raw: { FirstName: "Casey", EmailAddress: "casey@example.com" },
    });
    const companyClaim = await createAndClaim(runId);
    await harness!.repository.commitBatch({ ...companyClaim, records: [], now: now() });
    await harness!.pool.query(
      `INSERT INTO contacts (first_name, last_name, email)
       VALUES ('Casey', 'Jones', 'casey@example.com')`,
    );
    const contactClaim = await harness!.repository.claimNext({ workerId: randomUUID(), now: now() });
    expect(contactClaim?.phase).toBe("contacts");
    const batch = await harness!.repository.loadBatch({ ...contactClaim!, limit: 50 });
    expect(batch[0]!.candidates).toHaveLength(1);
    const loadedResolution = resolveArchiveProfile(batch[0]!);
    expect(loadedResolution.action).toMatch(/link_existing|update_existing/);
    await harness!.pool.query(
      `INSERT INTO contacts (first_name, last_name, email)
       VALUES ('Casey', 'Smith', 'casey@example.com')`,
    );

    await expect(harness!.repository.commitBatch({
      ...contactClaim!,
      records: [{ source: batch[0]!.source, resolution: loadedResolution }],
      now: now(),
    })).rejects.toMatchObject({ code: "archive_profile_target_set_changed" });
    expect(await count("contacts")).toBe(2);
    expect(await count("act_external_links")).toBe(0);
  });

  it("caps source plus relationship evidence at 50 and omits overflowed parents", async () => {
    const runId = await seedRun();
    await Promise.all(Array.from({ length: 49 }, (_, index) => seedSource({
      runId,
      index: index + 1,
      streamType: "contact",
      raw: { FirstName: `Contact ${index + 1}`, LastName: "Cap" },
    })));
    for (const [index, companyActId] of [[100, "company-a"], [101, "company-b"]] as const) {
      const sourceRecordId = orderedUuid(index);
      await harness!.pool.query(
        `INSERT INTO act_source_records
          (id, source_database_key, stream_type, source_key, act_record_id,
           first_seen_run_id, last_seen_run_id, relationship_evidence)
         VALUES ($1, $2, 'company_contact', $3, $3, $4, $4, $5::jsonb)`,
        [sourceRecordId, databaseKey, `relationship-${index}`, runId, JSON.stringify({
          parentKind: "company",
          parentActRecordId: companyActId,
          targetActRecordId: "contact-act-1",
        })],
      );
      const version = await harness!.pool.query<{ id: string }>(
        `INSERT INTO act_source_record_versions
          (source_record_id, source_database_key, fingerprint, raw_snapshot, observed_run_id)
         VALUES ($1, $2, $3, '{}'::jsonb, $4) RETURNING id`,
        [sourceRecordId, databaseKey, `relationship-${index}`, runId],
      );
      await harness!.pool.query(`UPDATE act_source_records SET latest_version_id = $1 WHERE id = $2`, [
        version.rows[0]!.id,
        sourceRecordId,
      ]);
    }
    const companyClaim = await createAndClaim(runId);
    await harness!.repository.commitBatch({ ...companyClaim, records: [], now: now() });
    const contactClaim = await harness!.repository.claimNext({ workerId: "relationship-cap", now: now() });
    const batch = await harness!.repository.loadBatch({ ...contactClaim!, limit: 50 });
    expect(batch).toHaveLength(49);
    expect(batch[0]!.source.relationshipEvidence).not.toHaveProperty("relationshipEvidenceComplete");
    expect(batch[0]!.source.relationshipEvidence).not.toHaveProperty("companyActRecordIds");
  });

  it("rolls back cursor and profile writes together", async () => {
    const runId = await seedRun();
    const first = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Must Roll Back" } });
    const second = await seedSource({ runId, index: 2, streamType: "company", raw: { Name: "Missing Target" } });
    const claim = await createAndClaim(runId);
    const valid = resolveArchiveProfile({ source: first.source, candidates: [], linkedTarget: null });
    const invalid = resolveArchiveProfile({ source: second.source, candidates: [], linkedTarget: null });
    await harness!.pool.query(`
      CREATE FUNCTION reject_second_archive_link() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.source_record_id = '${second.sourceRecordId}'::uuid THEN
          RAISE EXCEPTION 'forced batch rollback';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_second_archive_link
      BEFORE INSERT ON act_external_links FOR EACH ROW EXECUTE FUNCTION reject_second_archive_link();
    `);

    await expect(harness!.repository.commitBatch({
      ...claim,
      records: [
        { source: first.source, resolution: valid },
        { source: second.source, resolution: invalid },
      ],
      now: now(),
    })).rejects.toThrow("forced batch rollback");

    expect(await count("organizations")).toBe(0);
    expect(await count("act_external_links")).toBe(0);
    expect(await count("act_archive_profile_import_results")).toBe(0);
    const job = await harness!.pool.query<{ cursor_source_record_id: string | null }>(
      `SELECT cursor_source_record_id FROM act_archive_profile_import_jobs WHERE id = $1`,
      [claim.jobId],
    );
    expect(job.rows[0]!.cursor_source_record_id).toBeNull();
  });

  it("reconciles retry counters without counting the source twice", async () => {
    const runId = await seedRun();
    const first = await seedSource({ runId, index: 1, streamType: "company", raw: { Name: "Retry Co" } });
    const second = await seedSource({ runId, index: 2, streamType: "company", raw: { Name: "Deterministic Later" } });
    const claim = await createAndClaim(runId);
    const retry: ArchiveProfileResolution = {
      action: "retry_later", reasonCode: "ai_timeout", evidenceLabels: ["missing_required_identity"],
    };
    const deterministic = resolveArchiveProfile({ source: second.source, candidates: [], linkedTarget: null });
    await harness!.repository.commitBatch({
      ...claim,
      records: [
        { source: first.source, resolution: retry },
        { source: second.source, resolution: deterministic },
      ],
      now: now(),
    });
    const retryAt = new Date(Date.now() - 1_000);
    await harness!.pool.query(
      `UPDATE act_archive_profile_import_results SET retry_after = $1 WHERE source_record_id = $2`,
      [retryAt, first.sourceRecordId],
    );
    await harness!.pool.query(
      `UPDATE act_archive_profile_import_jobs SET retry_after = NULL WHERE id = $1`,
      [claim.jobId],
    );
    const secondClaim = await harness!.repository.claimNext({ workerId: "retry", now: now() });
    expect(secondClaim).not.toBeNull();
    const success = resolveArchiveProfile({ source: first.source, candidates: [], linkedTarget: null });
    const committed = await harness!.repository.commitBatch({
      ...secondClaim!, records: [{ source: first.source, resolution: success }], now: now(),
    });

    expect(committed.status).toMatchObject({
      processedCount: 2,
      createdCount: 2,
      retryableFailureCount: 0,
    });
    const result = await harness!.pool.query<{ attempt_count: number; status: string }>(
      `SELECT attempt_count, status FROM act_archive_profile_import_results WHERE source_record_id = $1`,
      [first.sourceRecordId],
    );
    expect(result.rows[0]).toEqual({ attempt_count: 1, status: "created" });
    expect(second.sourceRecordId).toBe(orderedUuid(2));
  });
});
