import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@workspace/db/event-date-coverage-schema";
import { CoverageJobRepository } from "./coverage-job-repository";

const ids = Array.from({ length: 30 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
let client: PGlite;
let repository: CoverageJobRepository;

beforeEach(async () => {
  client = new PGlite();
  await client.exec("CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL)");
  for (const [index, id] of ids.entries()) await client.query("INSERT INTO organizations VALUES ($1,$2)", [id, `Event ${index}`]);
  await client.exec(await readFile(new URL("../../../../../lib/db/migrations/20260921_event_date_coverage.sql", import.meta.url), "utf8"));
  repository = new CoverageJobRepository(drizzle(client, { schema }));
});
afterEach(async () => client.close());

describe("CoverageJobRepository", () => {
  it("defaults to 25 and deduplicates explicit selection", async () => {
    const run = await repository.createRun({ organizationIds: [...ids, ids[0]!], requestedBy: "owner" });
    expect(run.batchSize).toBe(25);
    expect((await repository.getRun(run.id))?.items).toHaveLength(25);
  });

  it("claims atomically, recovers an expired lease, and resumes after reconstruction", async () => {
    const run = await repository.createRun({ organizationIds: ids.slice(0, 2), requestedBy: "owner", batchSize: 2 });
    const now = new Date("2026-09-21T12:00:00Z");
    const first = await repository.claimNext({ workerId: "worker-a", now, leaseMs: 1_000, maxAttempts: 3 });
    expect(first).toMatchObject({ runId: run.id, status: "researching", attempts: 1, leaseOwner: "worker-a" });
    expect(await repository.claimNext({ workerId: "worker-b", now, leaseMs: 1_000, maxAttempts: 3 })).not.toMatchObject({ id: first?.id });

    const resumed = new CoverageJobRepository(drizzle(client, { schema }));
    const recovered = await resumed.claimNext({ workerId: "worker-c", now: new Date(now.getTime() + 2_000), leaseMs: 1_000, maxAttempts: 3 });
    expect(recovered).toMatchObject({ id: first?.id, attempts: 2, leaseOwner: "worker-c" });
  });

  it("enforces the retry ceiling and supports retry and cancellation", async () => {
    const run = await repository.createRun({ organizationIds: ids.slice(0, 2), requestedBy: "owner", batchSize: 2 });
    const now = new Date("2026-09-21T12:00:00Z");
    const item = await repository.claimNext({ workerId: "worker", now, leaseMs: 1, maxAttempts: 1 });
    await repository.failItem(item!.id, "failed", now, 1);
    expect(await repository.claimNext({ workerId: "worker", now: new Date(now.getTime() + 10), leaseMs: 1, maxAttempts: 1 })).not.toMatchObject({ id: item!.id });
    await repository.retryItem(item!.id);
    expect(await repository.getItem(item!.id)).toMatchObject({ status: "queued", attempts: 0 });
    await repository.cancelRun(run.id);
    expect(await repository.getRun(run.id)).toMatchObject({ status: "cancelled" });
    expect((await repository.getRun(run.id))?.items.every((entry) => ["failed", "skipped"].includes(entry.status))).toBe(true);
  });
});
