import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { AssistantJobRepository } from "./assistant-job-repository";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table assistant_jobs (
      id uuid primary key default gen_random_uuid(),
      actor_id text not null,
      capability text not null,
      original_instruction text not null,
      normalized_command jsonb not null default '{}'::jsonb,
      status text not null,
      stage text not null,
      progress jsonb not null default '{}'::jsonb,
      cancel_requested_at timestamptz,
      worker_id text,
      lease_expires_at timestamptz,
      attempt_count integer not null default 0,
      failure_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz
    );
    create table assistant_job_findings (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references assistant_jobs(id) on delete cascade,
      record_id uuid not null,
      record_label text not null,
      saved_url text not null,
      final_url text,
      status text not null,
      confidence text not null,
      reasons jsonb not null default '[]'::jsonb,
      suggested_url text,
      source_refs jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(job_id, record_id)
    );
    create table assistant_change_proposals (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references assistant_jobs(id) on delete cascade,
      record_id uuid not null,
      field text not null,
      old_value text,
      new_value text,
      confidence text not null,
      reasons jsonb not null default '[]'::jsonb,
      status text not null default 'proposed',
      approved_by text,
      approved_at timestamptz,
      applied_at timestamptz,
      failure_message text,
      created_at timestamptz not null default now(),
      unique(job_id, record_id, field)
    );
  `);
  return { client, repository: new AssistantJobRepository(client as never) };
}

describe("AssistantJobRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("creates actor-owned queued jobs and returns the latest job for that actor", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    const first = await repository.createJob({ actorId: "user-a", instruction: "Check all websites", normalizedCommand: {} });
    await client.query("update assistant_jobs set created_at='2026-08-20T00:00:00Z' where id=$1", [first]);
    const second = await repository.createJob({ actorId: "user-a", instruction: "Verify our event websites", normalizedCommand: {} });
    await repository.createJob({ actorId: "user-b", instruction: "Other actor", normalizedCommand: {} });

    expect((await repository.getJob({ actorId: "user-a", jobId: second }))?.status).toBe("queued");
    expect(await repository.getJob({ actorId: "user-b", jobId: second })).toBeNull();
    expect((await repository.getLatestJob("user-a"))?.id).toBe(second);
  });

  it("claims one runnable job with a lease and does not double-claim it", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    const jobId = await repository.createJob({ actorId: "user-a", instruction: "Check all websites", normalizedCommand: {} });
    const now = new Date("2026-08-21T16:00:00Z");

    const first = await repository.claimRunnable({ workerId: "worker-a", now, leaseMs: 30_000 });
    const second = await repository.claimRunnable({ workerId: "worker-b", now, leaseMs: 30_000 });

    expect(first?.jobId).toBe(jobId);
    expect(first?.workerId).toBe("worker-a");
    expect(second).toBeNull();
  });

  it("persists progress, findings, proposals, stop and resume state", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    const jobId = await repository.createJob({ actorId: "user-a", instruction: "Check all websites", normalizedCommand: {} });

    await repository.updateProgress(jobId, { total: 5, processed: 1, verified: 1, cursorAfterId: "10000000-0000-4000-8000-000000000001" });
    await repository.upsertFinding(jobId, {
      recordId: "10000000-0000-4000-8000-000000000001",
      recordLabel: "Morton County Fair",
      savedUrl: "https://old.example",
      finalUrl: "https://official.example",
      status: "replacement_found",
      confidence: "high",
      reasons: ["Official event identity matches"],
      suggestedUrl: "https://official.example",
      sourceRefs: ["https://official.example"],
    });
    await repository.upsertProposal(jobId, {
      recordId: "10000000-0000-4000-8000-000000000001",
      field: "website",
      oldValue: "https://old.example",
      newValue: "https://official.example",
      confidence: "high",
      reasons: ["Official event identity matches"],
    });

    expect(await repository.requestStop(jobId, "user-a")).toBe(true);
    await repository.markStopped(jobId);
    expect(await repository.continueJob(jobId, "user-a")).toBe(true);

    const job = await repository.getJob({ actorId: "user-a", jobId });
    expect(job?.progress).toMatchObject({ total: 5, processed: 1, verified: 1 });
    expect(job?.findings).toHaveLength(1);
    expect(job?.proposals).toHaveLength(1);
    expect(job?.status).toBe("queued");
  });
});
