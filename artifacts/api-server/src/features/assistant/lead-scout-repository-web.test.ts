import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { LeadScoutRepository } from "./lead-scout-repository";
import type {
  LeadDiscoveryCriteria,
  LeadScoutCandidateInput,
  LeadScoutSourceInput,
} from "./lead-scout-types";

const criteria: LeadDiscoveryCriteria = {
  originalQuestion: "Find events between Montana and Utah in September 2026",
  dateFrom: "2026-09-01", dateThrough: "2026-09-30", month: 9, year: 2026,
  regions: ["MT", "ID", "WY", "UT"], cities: [], geoMode: "corridor",
  routeId: null, legId: null, eventKeywords: ["festival"], fitIntent: "either",
};

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table lead_scout_runs (
      id uuid primary key default gen_random_uuid(), actor_id text not null,
      original_question text not null, criteria jsonb, criteria_summary text,
      crm_matches jsonb not null default '[]'::jsonb, status text not null default 'interpreting',
      stage text not null default 'interpreting',
      progress jsonb not null default '{"label":null,"sourcesChecked":0,"candidatesFound":0,"candidatesEnriched":0,"candidatesCompared":0}'::jsonb,
      worker_id text, lease_expires_at timestamptz, attempt_count integer not null default 0,
      web_started_at timestamptz, cancel_requested_at timestamptz,
      started_at timestamptz not null default now(), completed_at timestamptz,
      failure_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table lead_scout_sources (
      id uuid primary key default gen_random_uuid(), run_id uuid not null references lead_scout_runs(id) on delete cascade,
      url text not null, title text not null, publisher text, category text not null,
      retrieved_at timestamptz not null, excerpt text not null default '', created_at timestamptz not null default now(),
      unique(run_id, url)
    );
    create table lead_scout_candidates (
      id uuid primary key default gen_random_uuid(), run_id uuid not null references lead_scout_runs(id) on delete cascade,
      candidate_key text not null,
      name text not null, city text, region text, venue text, starts_at date, ends_at date,
      organizer_name text, organizer_email text, organizer_phone text, website text, event_type text,
      recurrence_summary text, attendance_summary text, vendor_summary text, application_deadline date,
      fit_score integer, fit_rationale text, crm_match_status text not null default 'new_prospect',
      matched_organization_id uuid, matched_booking_id uuid, review_status text not null default 'unreviewed',
      saved_organization_id uuid, saved_booking_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique(run_id, candidate_key)
    );
    create table lead_scout_candidate_facts (
      id uuid primary key default gen_random_uuid(), candidate_id uuid not null references lead_scout_candidates(id) on delete cascade,
      fact_key text not null, fact_value jsonb, category text not null, confidence text not null,
      rationale text not null, source_ids jsonb not null default '[]'::jsonb, created_at timestamptz not null default now()
    );
  `);
  return { client, repository: new LeadScoutRepository(client as never) };
}

async function crmReady(repository: LeadScoutRepository, actorId = "user-a") {
  const runId = await repository.createRun({ actorId, question: criteria.originalQuestion, criteria: null, criteriaSummary: null });
  await repository.setCriteria(runId, { criteria, criteriaSummary: "September 2026 · MT to UT" });
  await repository.setCrmReady(runId, []);
  return runId;
}

const source: LeadScoutSourceInput = {
  url: "https://example.org/events", title: "Example events", publisher: "Example",
  category: "tourism_chamber", retrievedAt: "2026-08-19T17:00:00.000Z", excerpt: "September event calendar",
};

const candidate: LeadScoutCandidateInput = {
  name: "Silver Valley Days", city: "Kellogg", region: "ID", venue: "Downtown",
  startsAt: "2026-09-11", endsAt: "2026-09-13", website: "https://example.org/silver-valley-days",
  eventType: "community festival", rationale: "Family festival with public vendor space.",
};

describe("LeadScoutRepository durable web state", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("starts only the actor's crm_ready run", async () => {
    const { client, repository } = await createDatabase(); clients.push(client);
    const runId = await crmReady(repository);
    expect(await repository.startWeb(runId, "user-b")).toBe(false);
    expect(await repository.startWeb(runId, "user-a")).toBe(true);
    const run = await repository.getRun({ actorId: "user-a", runId });
    expect(run).toMatchObject({ status: "running", stage: "source_discovery" });
    expect(run?.progress.label).toMatch(/public event sources/i);
  });

  it("leases a runnable run to one worker and allows stale lease recovery", async () => {
    const { client, repository } = await createDatabase(); clients.push(client);
    const runId = await crmReady(repository); await repository.startWeb(runId, "user-a");
    const now = new Date("2026-08-19T18:00:00Z");
    const first = await repository.claimRunnable({ workerId: "worker-a", now, leaseMs: 30_000 });
    expect(first?.runId).toBe(runId);
    expect(await repository.claimRunnable({ workerId: "worker-b", now, leaseMs: 30_000 })).toBeNull();
    const recovered = await repository.claimRunnable({ workerId: "worker-b", now: new Date("2026-08-19T18:00:31Z"), leaseMs: 30_000 });
    expect(recovered?.runId).toBe(runId);
  });

  it("moves running to stopping, preserves partial data, and continues a stopped run", async () => {
    const { client, repository } = await createDatabase(); clients.push(client);
    const runId = await crmReady(repository); await repository.startWeb(runId, "user-a");
    await repository.upsertSources(runId, [source]); await repository.upsertCandidates(runId, [candidate]);
    expect(await repository.requestStop(runId, "user-a")).toBe(true);
    expect((await repository.getRun({ actorId: "user-a", runId }))?.status).toBe("stopping");
    expect(await repository.isCancellationRequested(runId)).toBe(true);
    await repository.stopRun(runId);
    expect((await repository.getRun({ actorId: "user-a", runId }))?.status).toBe("stopped");
    expect(await repository.continueWeb(runId, "user-a")).toBe(true);
    const resumed = await repository.getRun({ actorId: "user-a", runId });
    expect(resumed?.status).toBe("running"); expect(resumed?.sources).toHaveLength(1); expect(resumed?.candidates).toHaveLength(1);
  });

  it("upserts sources and candidates idempotently", async () => {
    const { client, repository } = await createDatabase(); clients.push(client);
    const runId = await crmReady(repository);
    await repository.upsertSources(runId, [source, { ...source, title: "Updated calendar" }]);
    await repository.upsertCandidates(runId, [candidate, { ...candidate, rationale: "Updated fit rationale" }]);
    const run = await repository.getRun({ actorId: "user-a", runId });
    expect(run?.sources).toHaveLength(1); expect(run?.sources[0]?.title).toBe("Updated calendar");
    expect(run?.candidates).toHaveLength(1); expect(run?.candidates[0]?.fitRationale).toBe("Updated fit rationale");
  });

  it("keeps completed candidates when a later stage fails", async () => {
    const { client, repository } = await createDatabase(); clients.push(client);
    const runId = await crmReady(repository); await repository.startWeb(runId, "user-a");
    await repository.upsertCandidates(runId, [candidate]); await repository.failRun(runId, "provider unavailable");
    const run = await repository.getRun({ actorId: "user-a", runId });
    expect(run?.status).toBe("failed");
    expect(run?.candidates.map((item) => item.name)).toEqual(["Silver Valley Days"]);
  });
});
