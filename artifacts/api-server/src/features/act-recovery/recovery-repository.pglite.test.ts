import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DrizzleActArchiveRecoveryRepository } from "./recovery-repository";

const databaseKey = "act-archive-test";
const now = new Date("2026-08-16T14:00:00Z");
const companySource = "10000000-0000-4000-8000-000000000001";
const contactSource = "10000000-0000-4000-8000-000000000002";
const historySource = "10000000-0000-4000-8000-000000000003";
const ignoredNoVersion = "10000000-0000-4000-8000-000000000004";

let client: PGlite;
let database: ReturnType<typeof drizzle>;
let repository: DrizzleActArchiveRecoveryRepository;

async function rows<T = Record<string, unknown>>(query: string) {
  return (await client.query<T>(query)).rows;
}

beforeEach(async () => {
  client = new PGlite();
  database = drizzle(client);
  repository = new DrizzleActArchiveRecoveryRepository(database as never);

  await client.exec(`
    CREATE TABLE act_source_records (
      id uuid PRIMARY KEY,
      source_database_key text NOT NULL,
      stream_type text NOT NULL,
      source_key text NOT NULL,
      act_record_id text,
      latest_version_id uuid,
      relationship_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE act_source_record_versions (
      id uuid PRIMARY KEY,
      source_record_id uuid NOT NULL REFERENCES act_source_records(id),
      raw_snapshot jsonb NOT NULL,
      UNIQUE (id, source_record_id)
    );
  `);

  const migration = await readFile(
    fileURLToPath(new URL("../../../../../lib/db/migrations/043_act_archive_full_recovery.sql", import.meta.url)),
    "utf8",
  );
  await client.exec(migration);

  const versions = [
    [companySource, "20000000-0000-4000-8000-000000000001", "company", "company-1"],
    [contactSource, "20000000-0000-4000-8000-000000000002", "contact", "contact-1"],
    [historySource, "20000000-0000-4000-8000-000000000003", "history", "history-1"],
  ] as const;
  for (const [sourceId, versionId, streamType, actRecordId] of versions) {
    await client.query(
      `INSERT INTO act_source_records (id, source_database_key, stream_type, source_key, act_record_id)
       VALUES ($1, $2, $3, $4, $4)`,
      [sourceId, databaseKey, streamType, actRecordId],
    );
    await client.query(
      `INSERT INTO act_source_record_versions (id, source_record_id, raw_snapshot)
       VALUES ($1, $2, $3::jsonb)`,
      [versionId, sourceId, JSON.stringify({ id: actRecordId, streamType })],
    );
    await client.query(`UPDATE act_source_records SET latest_version_id = $1 WHERE id = $2`, [versionId, sourceId]);
  }
  await client.query(
    `INSERT INTO act_source_records (id, source_database_key, stream_type, source_key)
     VALUES ($1, $2, 'note', 'no-version')`,
    [ignoredNoVersion, databaseKey],
  );
});

afterEach(async () => {
  await client.close();
});

describe("DrizzleActArchiveRecoveryRepository", () => {
  it("snapshots every versioned archive source once with deterministic dependency priority", async () => {
    const first = await repository.createOrGetRun({
      sourceDatabaseKey: databaseKey,
      requestKey: "full-recovery-1",
      requestedBy: "owner",
      now,
    });
    const replay = await repository.createOrGetRun({
      sourceDatabaseKey: databaseKey,
      requestKey: "full-recovery-1",
      requestedBy: "owner",
      now,
    });

    expect(replay.runId).toBe(first.runId);
    expect(first.candidateCount).toBe(3);
    expect(await rows(`SELECT stream_type, priority FROM act_archive_recovery_items ORDER BY priority, source_record_id`)).toEqual([
      { stream_type: "company", priority: 10 },
      { stream_type: "contact", priority: 20 },
      { stream_type: "history", priority: 80 },
    ]);
    expect(await rows(`SELECT count(*)::int AS count FROM act_archive_recovery_items`)).toEqual([{ count: 3 }]);
  });

  it("leases work once, reclaims expired leases, and never reclaims terminal work", async () => {
    const run = await repository.createOrGetRun({
      sourceDatabaseKey: databaseKey,
      requestKey: "full-recovery-2",
      requestedBy: "owner",
      now,
    });

    const company = await repository.claimNext({ workerId: "worker-a", now });
    expect(company?.streamType).toBe("company");
    expect(company?.actRecordId).toBe("company-1");

    await client.query(
      `UPDATE act_archive_recovery_items
       SET lease_expires_at = $1
       WHERE id = $2`,
      [new Date(now.getTime() - 1_000), company!.itemId],
    );
    const reclaimed = await repository.claimNext({ workerId: "worker-b", now });
    expect(reclaimed?.itemId).toBe(company?.itemId);
    expect(reclaimed?.leaseToken).not.toBe(company?.leaseToken);

    await repository.complete({
      itemId: reclaimed!.itemId,
      leaseToken: reclaimed!.leaseToken,
      state: "recovered",
      targetSummary: { entityType: "organization" },
      now,
    });
    const next = await repository.claimNext({ workerId: "worker-c", now });
    expect(next?.streamType).toBe("contact");

    const status = await repository.status(run.runId);
    expect(status.candidateCount).toBe(3);
    expect(status.recovered).toBe(1);
    expect(status.pending + status.leased + status.retryableFailed + status.alreadyPresent + status.recovered + status.needsReview + status.droppedUnusable).toBe(3);
  });
});
