import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { PostgresLeadScoutCandidateSaveLinker } from "./lead-scout-candidate-save-store";

async function database() {
  const client = new PGlite();
  await client.exec(`
    create table lead_scout_runs (
      id uuid primary key default gen_random_uuid(),
      actor_id text not null
    );
    create table lead_scout_candidates (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references lead_scout_runs(id) on delete cascade,
      crm_match_status text not null default 'new_prospect',
      review_status text not null default 'unreviewed',
      matched_organization_id uuid,
      matched_booking_id uuid,
      saved_organization_id uuid,
      saved_booking_id uuid,
      updated_at timestamptz not null default now()
    );
  `);
  const run = await client.query(`insert into lead_scout_runs(actor_id) values ('owner-a') returning id`);
  const runId = String(run.rows[0]?.id);
  const candidate = await client.query(`insert into lead_scout_candidates(run_id) values ($1) returning id`, [runId]);
  return {
    client,
    runId,
    candidateId: String(candidate.rows[0]?.id),
    linker: new PostgresLeadScoutCandidateSaveLinker(client as never),
  };
}

describe("PostgresLeadScoutCandidateSaveLinker", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("atomically links an actor-owned unsaved candidate to its new CRM records", async () => {
    const db = await database(); clients.push(db.client);
    expect(await db.linker.markSaved({
      runId: db.runId,
      actorId: "owner-a",
      candidateId: db.candidateId,
      profileId: "10000000-0000-4000-8000-000000000001",
      bookingId: "20000000-0000-4000-8000-000000000001",
    })).toBe(true);

    const row = (await db.client.query(`select review_status, crm_match_status, matched_organization_id,
      matched_booking_id, saved_organization_id, saved_booking_id from lead_scout_candidates where id=$1`, [db.candidateId])).rows[0];
    expect(row).toMatchObject({
      review_status: "saved",
      crm_match_status: "existing",
      matched_organization_id: "10000000-0000-4000-8000-000000000001",
      matched_booking_id: "20000000-0000-4000-8000-000000000001",
      saved_organization_id: "10000000-0000-4000-8000-000000000001",
      saved_booking_id: "20000000-0000-4000-8000-000000000001",
    });
  });

  it("does not link another actor's, dismissed, possible-match, or already-saved candidate", async () => {
    const db = await database(); clients.push(db.client);
    const input = {
      runId: db.runId,
      actorId: "owner-b",
      candidateId: db.candidateId,
      profileId: "10000000-0000-4000-8000-000000000001",
      bookingId: "20000000-0000-4000-8000-000000000001",
    };
    expect(await db.linker.markSaved(input)).toBe(false);

    await db.client.query(`update lead_scout_candidates set review_status='dismissed' where id=$1`, [db.candidateId]);
    expect(await db.linker.markSaved({ ...input, actorId: "owner-a" })).toBe(false);
    await db.client.query(`update lead_scout_candidates set review_status='unreviewed', crm_match_status='possible_match' where id=$1`, [db.candidateId]);
    expect(await db.linker.markSaved({ ...input, actorId: "owner-a" })).toBe(false);
    await db.client.query(`update lead_scout_candidates set review_status='saved', crm_match_status='new_prospect' where id=$1`, [db.candidateId]);
    expect(await db.linker.markSaved({ ...input, actorId: "owner-a" })).toBe(false);
  });
});
