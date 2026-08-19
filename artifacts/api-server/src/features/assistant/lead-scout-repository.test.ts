import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { LeadScoutRepository } from "./lead-scout-repository";
import type { AssistantLeadMatch, LeadDiscoveryCriteria } from "./lead-scout-types";

async function createDatabase() {
  const client = new PGlite();
  await client.exec(`
    create table lead_scout_runs (
      id uuid primary key default gen_random_uuid(),
      actor_id text not null,
      original_question text not null,
      criteria jsonb,
      criteria_summary text,
      crm_matches jsonb not null default '[]'::jsonb,
      status text not null default 'interpreting',
      stage text not null default 'interpreting',
      progress jsonb not null default '{"label":null,"sourcesChecked":0,"candidatesFound":0,"candidatesEnriched":0,"candidatesCompared":0}'::jsonb,
      worker_id text,
      lease_expires_at timestamptz,
      attempt_count integer not null default 0,
      web_started_at timestamptz,
      cancel_requested_at timestamptz,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      failure_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table lead_scout_sources (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references lead_scout_runs(id) on delete cascade,
      url text not null,
      title text not null,
      publisher text,
      category text not null,
      retrieved_at timestamptz not null,
      excerpt text not null default '',
      created_at timestamptz not null default now()
    );

    create table lead_scout_candidates (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references lead_scout_runs(id) on delete cascade,
      name text not null,
      city text,
      region text,
      venue text,
      starts_at date,
      ends_at date,
      organizer_name text,
      organizer_email text,
      organizer_phone text,
      website text,
      event_type text,
      recurrence_summary text,
      attendance_summary text,
      vendor_summary text,
      application_deadline date,
      fit_score integer,
      fit_rationale text,
      crm_match_status text not null default 'new_prospect',
      matched_organization_id uuid,
      matched_booking_id uuid,
      review_status text not null default 'unreviewed',
      saved_organization_id uuid,
      saved_booking_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table lead_scout_candidate_facts (
      id uuid primary key default gen_random_uuid(),
      candidate_id uuid not null references lead_scout_candidates(id) on delete cascade,
      fact_key text not null,
      fact_value jsonb,
      category text not null,
      confidence text not null,
      rationale text not null,
      source_ids jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  return { client, repository: new LeadScoutRepository(client as never) };
}

const criteria: LeadDiscoveryCriteria = {
  originalQuestion: "Find events between Montana and Utah in September 2026",
  dateFrom: "2026-09-01",
  dateThrough: "2026-09-30",
  month: 9,
  year: 2026,
  regions: ["MT", "ID", "WY", "UT"],
  cities: [],
  geoMode: "corridor",
  routeId: null,
  legId: null,
  eventKeywords: [],
  fitIntent: "either",
};

const matches: AssistantLeadMatch[] = [
  {
    organizationId: "10000000-0000-4000-8000-000000000001",
    bookingId: "20000000-0000-4000-8000-000000000001",
    label: "September Fair",
    city: "Billings",
    region: "MT",
    dateFrom: "2026-09-10",
    dateThrough: "2026-09-12",
    dateConfidence: "confirmed",
    status: "possible",
    relationshipSummary: "Past Adventure Zone customer",
    reasons: ["Confirmed September date", "On requested corridor"],
    fitScore: 950,
  },
];

describe("LeadScoutRepository", () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  it("creates an actor-owned interpreting run without creating candidates or sources", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);

    const runId = await repository.createRun({
      actorId: "user-a",
      question: criteria.originalQuestion,
      criteria: null,
      criteriaSummary: null,
    });

    const run = await repository.getRun({ actorId: "user-a", runId });
    expect(run).toMatchObject({
      id: runId,
      originalQuestion: criteria.originalQuestion,
      criteria: null,
      criteriaSummary: null,
      status: "interpreting",
      stage: "interpreting",
      crmMatches: [],
      candidates: [],
      sources: [],
    });
    expect(await repository.getRun({ actorId: "user-b", runId })).toBeNull();
    expect((await client.query("select count(*)::int as count from lead_scout_candidates")).rows).toEqual([{ count: 0 }]);
    expect((await client.query("select count(*)::int as count from lead_scout_sources")).rows).toEqual([{ count: 0 }]);
  });

  it("persists criteria and transitions to crm_ready with bounded CRM results", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    const runId = await repository.createRun({
      actorId: "user-a",
      question: criteria.originalQuestion,
      criteria: null,
      criteriaSummary: null,
    });

    await repository.setCriteria(runId, {
      criteria,
      criteriaSummary: "September 1–30, 2026 · Montana-to-Utah corridor",
    });
    await repository.setCrmReady(runId, matches);

    const run = await repository.getRun({ actorId: "user-a", runId });
    expect(run?.status).toBe("crm_ready");
    expect(run?.stage).toBe("crm_search");
    expect(run?.criteria).toEqual(criteria);
    expect(run?.crmMatches).toEqual(matches);
  });

  it("returns the newest run for an actor only", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    const first = await repository.createRun({ actorId: "user-a", question: "first", criteria: null, criteriaSummary: null });
    await client.query("update lead_scout_runs set created_at = '2026-08-18T00:00:00Z' where id = $1", [first]);
    const second = await repository.createRun({ actorId: "user-a", question: "second", criteria, criteriaSummary: "second summary" });
    await repository.createRun({ actorId: "user-b", question: "other user", criteria, criteriaSummary: "other" });

    expect((await repository.getLatestRun("user-a"))?.id).toBe(second);
    expect((await repository.getLatestRun("user-b"))?.originalQuestion).toBe("other user");
  });

  it("records a bounded failure on the run", async () => {
    const { client, repository } = await createDatabase();
    clients.push(client);
    const runId = await repository.createRun({ actorId: "user-a", question: "broken search", criteria: null, criteriaSummary: null });

    await repository.setFailed(runId, "x".repeat(2000));
    const run = await repository.getRun({ actorId: "user-a", runId });

    expect(run?.status).toBe("failed");
    expect(run?.failureMessage?.length).toBeLessThanOrEqual(1000);
    expect(run?.completedAt).toBeTruthy();
  });
});
