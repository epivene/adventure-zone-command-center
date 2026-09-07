import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { LeadScoutRepository } from "./lead-scout-repository";
import type { LeadScoutEvidenceFact } from "./lead-scout-types";

function rowValue(rows: unknown[], index: number, key: string): unknown {
  const row = rows[index];
  return row && typeof row === "object" && !Array.isArray(row) && key in row
    ? (row as Record<string, unknown>)[key]
    : undefined;
}

async function database() {
  const client = new PGlite();
  await client.exec(`
    create table lead_scout_runs (
      id uuid primary key default gen_random_uuid(), actor_id text not null, original_question text not null,
      criteria jsonb, criteria_summary text, crm_matches jsonb not null default '[]'::jsonb,
      status text not null default 'complete', stage text not null default 'complete',
      progress jsonb not null default '{"label":null,"sourcesChecked":0,"candidatesFound":0,"candidatesEnriched":0,"candidatesCompared":0}'::jsonb,
      worker_id text, lease_expires_at timestamptz, attempt_count integer not null default 0,
      web_started_at timestamptz, cancel_requested_at timestamptz, started_at timestamptz not null default now(),
      completed_at timestamptz, failure_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table lead_scout_sources (
      id uuid primary key default gen_random_uuid(), run_id uuid not null references lead_scout_runs(id) on delete cascade,
      url text not null, title text not null, publisher text, category text not null, retrieved_at timestamptz not null,
      excerpt text not null default '', created_at timestamptz not null default now(), unique(run_id,url)
    );
    create table lead_scout_candidates (
      id uuid primary key default gen_random_uuid(), run_id uuid not null references lead_scout_runs(id) on delete cascade,
      candidate_key text not null, name text not null, city text, region text, venue text, starts_at date, ends_at date,
      organizer_name text, organizer_email text, organizer_phone text, website text, event_type text,
      recurrence_summary text, attendance_summary text, vendor_summary text, application_deadline date,
      fit_score integer, fit_rationale text, fit_reasons jsonb not null default '[]'::jsonb,
      fit_cautions jsonb not null default '[]'::jsonb, crm_match_status text not null default 'new_prospect',
      matched_organization_id uuid, matched_booking_id uuid, review_status text not null default 'unreviewed',
      enrichment_status text not null default 'needs_enrichment', coverage_gaps jsonb not null default '[]'::jsonb,
      enrichment_error text, enriched_at timestamptz, deepen_requested_at timestamptz,
      saved_organization_id uuid, saved_booking_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique(run_id,candidate_key)
    );
    create table lead_scout_candidate_facts (
      id uuid primary key default gen_random_uuid(), candidate_id uuid not null references lead_scout_candidates(id) on delete cascade,
      fact_key text not null, fact_value jsonb, category text not null, confidence text not null, rationale text not null,
      source_ids jsonb not null default '[]'::jsonb, created_at timestamptz not null default now()
    );
  `);
  const run = await client.query(`insert into lead_scout_runs(actor_id, original_question, status, stage, completed_at)
    values ('owner-a','find events','complete','complete',now()) returning id`);
  const runId = String(rowValue(run.rows, 0, "id"));
  const other = await client.query(`insert into lead_scout_runs(actor_id, original_question) values ('owner-b','other') returning id`);
  const otherRunId = String(rowValue(other.rows, 0, "id"));
  const source = await client.query(`insert into lead_scout_sources(run_id,url,title,category,retrieved_at)
    values ($1,'https://event.example/vendors','Vendor page','vendor_application',now()) returning id`, [runId]);
  await client.query(`insert into lead_scout_sources(run_id,url,title,category,retrieved_at)
    values ($1,'https://other.example/source','Other source','official_event',now())`, [otherRunId]);
  const candidate = await client.query(`insert into lead_scout_candidates(run_id,candidate_key,name,city,region,website,enrichment_status)
    values ($1,'key-1','Silver Valley Days','Kellogg','ID','https://event.example','enriched') returning id`, [runId]);
  return {
    client,
    repository: new LeadScoutRepository(client as never),
    runId,
    candidateId: String(rowValue(candidate.rows, 0, "id")),
    sourceId: String(rowValue(source.rows, 0, "id")),
  };
}

const fact: LeadScoutEvidenceFact = {
  key: "vendor_deadline",
  value: "2027-06-01",
  category: "vendor",
  confidence: "high",
  sourceUrls: ["https://event.example/vendors"],
  rationale: "Official vendor page.",
};

describe("LeadScoutRepository candidate enrichment", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("replaces candidate facts idempotently and maps only same-run source ids", async () => {
    const db = await database(); clients.push(db.client);
    await db.repository.replaceCandidateFacts(db.runId, db.candidateId, [
      fact,
      { ...fact, key: "bad_cross_run", sourceUrls: ["https://other.example/source"] },
    ]);
    await db.repository.replaceCandidateFacts(db.runId, db.candidateId, [{ ...fact, value: "2027-06-02" }]);
    const rows = (await db.client.query(`select fact_key, fact_value, source_ids from lead_scout_candidate_facts`)).rows;
    expect(rows).toHaveLength(1);
    expect(rowValue(rows, 0, "fact_key")).toBe("vendor_deadline");
    expect(rowValue(rows, 0, "fact_value")).toBe("2027-06-02");
    expect(rowValue(rows, 0, "source_ids")).toEqual([db.sourceId]);
  });

  it("queues Research deeper for one actor-owned eligible candidate and reopens the run", async () => {
    const db = await database(); clients.push(db.client);
    expect(await db.repository.queueCandidateDeepen(db.runId, "owner-b", db.candidateId)).toBe(false);
    expect(await db.repository.queueCandidateDeepen(db.runId, "owner-a", db.candidateId)).toBe(true);
    const run = await db.repository.getRun({ actorId: "owner-a", runId: db.runId });
    expect(run?.status).toBe("running");
    expect(run?.stage).toBe("candidate_enrichment");
    expect(run?.candidates[0]?.enrichmentStatus).toBe("needs_enrichment");
  });

  it("persists Not a fit as a candidate review decision without deleting the prospect or touching CRM", async () => {
    const db = await database(); clients.push(db.client);
    expect(await db.repository.dismissCandidate(db.runId, "owner-b", db.candidateId)).toBe(false);
    expect(await db.repository.dismissCandidate(db.runId, "owner-a", db.candidateId)).toBe(true);
    const rows = (await db.client.query(`select id, review_status, saved_organization_id, saved_booking_id from lead_scout_candidates where id=$1`, [db.candidateId])).rows;
    expect(rows).toEqual([{ id: db.candidateId, review_status: "dismissed", saved_organization_id: null, saved_booking_id: null }]);
  });

  it("does not reactivate dismissed or saved candidates", async () => {
    const db = await database(); clients.push(db.client);
    await db.client.query(`update lead_scout_candidates set review_status='dismissed' where id=$1`, [db.candidateId]);
    expect(await db.repository.queueCandidateDeepen(db.runId, "owner-a", db.candidateId)).toBe(false);
    await db.client.query(`update lead_scout_candidates set review_status='saved' where id=$1`, [db.candidateId]);
    expect(await db.repository.queueCandidateDeepen(db.runId, "owner-a", db.candidateId)).toBe(false);
  });

  it("keeps enrichment failures on the candidate rather than deleting it", async () => {
    const db = await database(); clients.push(db.client);
    await db.repository.failCandidateEnrichment(db.runId, db.candidateId, "vendor page unavailable");
    const run = await db.repository.getRun({ actorId: "owner-a", runId: db.runId });
    expect(run?.candidates[0]?.enrichmentStatus).toBe("enrichment_failed");
    expect(run?.candidates[0]?.enrichmentError).toMatch(/vendor page unavailable/i);
  });
});
