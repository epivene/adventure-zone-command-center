import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { ScoutAlertRepository } from "./scout-alert-repository";
import type { ScoutAlertDraft, ScoutAlertSnapshot } from "./scout-alert-types";

function rowValue(rows: unknown[], index: number, key: string): unknown {
  const row = rows[index];
  return row && typeof row === "object" && !Array.isArray(row) && key in row
    ? (row as Record<string, unknown>)[key]
    : undefined;
}

const NOW = new Date("2026-08-25T12:00:00.000Z");

async function database() {
  const client = new PGlite();
  await client.exec(`
    create table organizations (
      id uuid primary key,
      name text not null
    );
    create table bookings (
      id uuid primary key,
      organization_id uuid,
      status text not null,
      ends_at timestamptz
    );
    create table lead_scout_runs (
      id uuid primary key,
      actor_id text not null,
      original_question text not null,
      criteria jsonb,
      criteria_summary text,
      status text not null,
      stage text not null,
      progress jsonb not null default '{}'::jsonb,
      crm_matches jsonb not null default '[]'::jsonb,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      failure_message text
    );
    create table lead_scout_sources (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null,
      url text not null,
      title text not null,
      publisher text,
      category text not null,
      retrieved_at timestamptz not null,
      created_at timestamptz not null default now()
    );
    create table lead_scout_candidates (
      id uuid primary key,
      run_id uuid not null,
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
      fit_reasons jsonb not null default '[]'::jsonb,
      fit_cautions jsonb not null default '[]'::jsonb,
      crm_match_status text not null,
      matched_organization_id uuid,
      matched_booking_id uuid,
      review_status text not null,
      enrichment_status text,
      coverage_gaps jsonb not null default '[]'::jsonb,
      enrichment_error text,
      enriched_at timestamptz,
      deepen_requested_at timestamptz,
      saved_organization_id uuid,
      saved_booking_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table lead_scout_candidate_facts (
      id uuid primary key default gen_random_uuid(),
      candidate_id uuid not null,
      fact_key text not null,
      fact_value jsonb,
      category text not null,
      confidence text not null,
      rationale text not null,
      source_ids jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now()
    );
    create table scout_alert_watches (
      id uuid primary key default gen_random_uuid(),
      candidate_id uuid not null unique,
      actor_id text not null,
      organization_id uuid not null,
      booking_id uuid,
      status text not null default 'active',
      snapshot jsonb,
      next_evaluation_at timestamptz not null,
      next_research_at timestamptz not null,
      last_evaluated_at timestamptz,
      last_researched_at timestamptz,
      last_error text,
      failure_count integer not null default 0,
      worker_id text,
      lease_expires_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table scout_alerts (
      id uuid primary key default gen_random_uuid(),
      watch_id uuid not null,
      organization_id uuid not null,
      booking_id uuid,
      kind text not null,
      severity text not null,
      title text not null,
      body text not null,
      before_value jsonb,
      after_value jsonb,
      sources jsonb not null default '[]'::jsonb,
      confidence text,
      fingerprint text not null unique,
      status text not null default 'open',
      due_at timestamptz,
      snoozed_until timestamptz,
      detected_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  const ids = {
    organizationId: "10000000-0000-4000-8000-000000000001",
    bookingId: "20000000-0000-4000-8000-000000000001",
    runId: "30000000-0000-4000-8000-000000000001",
    candidateId: "40000000-0000-4000-8000-000000000001",
  };
  await client.query(`insert into organizations(id,name) values ($1,'Twin Falls County Fair')`, [ids.organizationId]);
  await client.query(`insert into bookings(id,organization_id,status,ends_at) values ($1,$2,'possible','2026-09-07T23:59:59Z')`, [ids.bookingId, ids.organizationId]);
  await client.query(`insert into lead_scout_runs(id,actor_id,original_question,criteria,criteria_summary,status,stage)
    values ($1,'owner-a','Find a Labor Day fair','{"originalQuestion":"Find a Labor Day fair","dateFrom":"2026-09-01","dateThrough":"2026-09-10","month":9,"year":2026,"regions":["ID"],"cities":[],"geoMode":"regions","routeId":null,"legId":null,"eventKeywords":["fair"],"fitIntent":"either"}'::jsonb,'Idaho · Labor Day 2026','complete','complete')`, [ids.runId]);
  await client.query(`insert into lead_scout_sources(run_id,url,title,publisher,category,retrieved_at)
    values ($1,'https://example.org/fair','Official fair page','Twin Falls County Fair','official_event',$2)`, [ids.runId, NOW.toISOString()]);
  await client.query(`insert into lead_scout_candidates(
    id,run_id,name,city,region,starts_at,ends_at,organizer_name,organizer_email,organizer_phone,website,
    event_type,vendor_summary,application_deadline,fit_score,fit_rationale,crm_match_status,review_status,
    enrichment_status,coverage_gaps,saved_organization_id,saved_booking_id)
    values ($1,$2,'Twin Falls County Fair','Filer','ID','2026-09-02','2026-09-07','Fair Office','fair@example.org','208-555-0100',
      'https://example.org/fair','county fair','Applications are open','2026-08-31',87,'Strong family fit','existing','saved','enriched',
      '["Power requirements were not published."]'::jsonb,$3,$4)`,
    [ids.candidateId, ids.runId, ids.organizationId, ids.bookingId]);
  const watch = await client.query(`insert into scout_alert_watches(
    candidate_id,actor_id,organization_id,booking_id,status,next_evaluation_at,next_research_at)
    values ($1,'owner-a',$2,$3,'active','2026-08-25T11:00:00Z','2026-09-01T12:00:00Z') returning id`,
    [ids.candidateId, ids.organizationId, ids.bookingId]);

  return {
    client,
    ids,
    watchId: String(rowValue(watch.rows, 0, "id")),
    repository: new ScoutAlertRepository(client as never),
  };
}

function snapshot(): ScoutAlertSnapshot {
  return {
    startsAt: "2026-09-02",
    endsAt: "2026-09-07",
    applicationAvailable: true,
    applicationUrl: "https://example.org/fair/vendors",
    applicationDeadline: "2026-08-31",
    organizerName: "Fair Office",
    organizerEmail: "fair@example.org",
    organizerPhone: "208-555-0100",
    coverageGaps: [],
    sources: [{
      url: "https://example.org/fair",
      title: "Official fair page",
      publisher: "Twin Falls County Fair",
      category: "official_event",
      retrievedAt: NOW.toISOString(),
    }],
    capturedAt: NOW.toISOString(),
  };
}

function alert(overrides: Partial<ScoutAlertDraft> = {}): ScoutAlertDraft {
  return {
    kind: "deadline_approaching",
    severity: "urgent",
    title: "Application deadline within 7 days",
    body: "Apply by August 31.",
    beforeValue: null,
    afterValue: { deadline: "2026-08-31", thresholdDays: 7 },
    sources: snapshot().sources,
    confidence: "high",
    fingerprint: "fingerprint-1",
    dueAt: "2026-08-31T23:59:59.999Z",
    ...overrides,
  };
}

describe("ScoutAlertRepository", () => {
  const clients: PGlite[] = [];
  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));

  it("claims one due active watch with a lease and loads its Scout context", async () => {
    const db = await database(); clients.push(db.client);
    const claim = await db.repository.claimDue({ workerId: "worker-a", now: NOW, leaseMs: 60_000 });

    expect(claim).toMatchObject({
      watchId: db.watchId,
      workerId: "worker-a",
      actorId: "owner-a",
      runId: db.ids.runId,
      candidateId: db.ids.candidateId,
      organizationId: db.ids.organizationId,
      bookingId: db.ids.bookingId,
      failureCount: 0,
      snapshot: null,
    });
    expect(claim?.leaseExpiresAt).toBe("2026-08-25T12:01:00.000Z");

    const competing = await db.repository.claimDue({ workerId: "worker-b", now: NOW, leaseMs: 60_000 });
    expect(competing).toBeNull();

    const context = await db.repository.loadContext(claim!);
    expect(context).toMatchObject({
      profileName: "Twin Falls County Fair",
      bookingStatus: "possible",
      bookingEndsAt: "2026-09-07",
    });
    expect(context?.candidate.name).toBe("Twin Falls County Fair");
    expect(context?.criteria.regions).toEqual(["ID"]);
    expect(context?.knownSources[0]).toMatchObject({
      url: "https://example.org/fair",
      category: "official_event",
    });
  });

  it("atomically saves a successful snapshot and idempotent alerts and releases the lease", async () => {
    const db = await database(); clients.push(db.client);
    const claim = await db.repository.claimDue({ workerId: "worker-a", now: NOW, leaseMs: 60_000 });
    await db.repository.saveSuccess({
      claim: claim!,
      snapshot: snapshot(),
      alerts: [alert()],
      now: NOW,
      nextEvaluationAt: new Date("2026-08-26T12:00:00Z"),
      nextResearchAt: new Date("2026-09-01T12:00:00Z"),
      researched: false,
    });

    const watch = (await db.client.query(`select snapshot,failure_count,worker_id,lease_expires_at,last_evaluated_at from scout_alert_watches where id=$1`, [db.watchId])).rows[0];
    expect(watch).toMatchObject({ failure_count: 0, worker_id: null, lease_expires_at: null });
    expect(rowValue([watch], 0, "snapshot")).toMatchObject({ applicationDeadline: "2026-08-31" });
    expect(new Date(String(rowValue([watch], 0, "last_evaluated_at"))).toISOString()).toBe(NOW.toISOString());

    const stored = await db.client.query(`select kind,severity,status,fingerprint from scout_alerts`);
    expect(stored.rows).toEqual([expect.objectContaining({
      kind: "deadline_approaching",
      severity: "urgent",
      status: "open",
      fingerprint: "fingerprint-1",
    })]);

    await db.client.query(`update scout_alert_watches set worker_id='worker-a',lease_expires_at='2026-08-25T12:01:00Z' where id=$1`, [db.watchId]);
    await db.repository.saveSuccess({
      claim: claim!, snapshot: snapshot(), alerts: [alert()], now: NOW,
      nextEvaluationAt: new Date("2026-08-26T12:00:00Z"),
      nextResearchAt: new Date("2026-09-01T12:00:00Z"), researched: false,
    });
    const count = await db.client.query(`select count(*)::int as count from scout_alerts`);
    expect(rowValue(count.rows, 0, "count")).toBe(1);
  });

  it("records failure backoff and inserts one monitoring alert when supplied", async () => {
    const db = await database(); clients.push(db.client);
    await db.client.query(`update scout_alert_watches set failure_count=2 where id=$1`, [db.watchId]);
    const claim = await db.repository.claimDue({ workerId: "worker-a", now: NOW, leaseMs: 60_000 });
    await db.repository.recordFailure({
      claim: claim!,
      profileName: "Twin Falls County Fair",
      now: NOW,
      safeError: "Provider unavailable",
      nextRetryAt: new Date("2026-08-25T18:00:00Z"),
      failureAlert: alert({
        kind: "monitoring_problem",
        severity: "info",
        title: "Scout could not refresh this profile",
        body: "Scout could not refresh.",
        afterValue: { consecutiveFailures: 3 },
        confidence: null,
        fingerprint: "monitoring-watch-1",
        dueAt: null,
        sources: [],
      }),
    });

    const watch = (await db.client.query(`select failure_count,last_error,next_evaluation_at,worker_id from scout_alert_watches where id=$1`, [db.watchId])).rows[0];
    expect(watch).toMatchObject({ failure_count: 3, last_error: "Provider unavailable", worker_id: null });
    expect(new Date(String(rowValue([watch], 0, "next_evaluation_at"))).toISOString()).toBe("2026-08-25T18:00:00.000Z");
    expect((await db.client.query(`select kind,status from scout_alerts`)).rows).toEqual([
      expect.objectContaining({ kind: "monitoring_problem", status: "open" }),
    ]);
  });

  it("completes a watch and resolves its open or snoozed alerts", async () => {
    const db = await database(); clients.push(db.client);
    await db.client.query(`insert into scout_alerts(watch_id,organization_id,booking_id,kind,severity,title,body,fingerprint,status,snoozed_until)
      values ($1,$2,$3,'needs_verification','info','Needs verification','Missing power','open-a','open',null),
             ($1,$2,$3,'deadline_approaching','urgent','Deadline','Soon','snoozed-a','snoozed','2026-09-01T12:00:00Z')`,
      [db.watchId, db.ids.organizationId, db.ids.bookingId]);
    const claim = await db.repository.claimDue({ workerId: "worker-a", now: NOW, leaseMs: 60_000 });
    await db.repository.completeWatch({ claim: claim!, now: NOW });

    expect((await db.client.query(`select status from scout_alert_watches where id=$1`, [db.watchId])).rows.length ? rowValue((await db.client.query(`select status from scout_alert_watches where id=$1`, [db.watchId])).rows, 0, "status") : undefined).toBe("complete");
    expect((await db.client.query(`select distinct status from scout_alerts`)).rows).toEqual([{ status: "resolved" }]);
  });

  it("lists open and expired-snoozed alerts in priority order and supports snooze and dismiss", async () => {
    const db = await database(); clients.push(db.client);
    await db.client.query(`insert into scout_alerts(
      watch_id,organization_id,booking_id,kind,severity,title,body,fingerprint,status,snoozed_until,due_at,detected_at,sources)
      values
      ($1,$2,$3,'needs_verification','info','Verify power','Power unknown','info-a','open',null,null,'2026-08-24T12:00:00Z','[]'::jsonb),
      ($1,$2,$3,'deadline_approaching','urgent','Deadline soon','Apply now','urgent-a','snoozed','2026-08-25T11:00:00Z','2026-08-26T23:59:59Z','2026-08-25T10:00:00Z','[{"url":"https://example.org/fair","title":"Official fair page","publisher":null,"category":"official_event","retrievedAt":"2026-08-25T10:00:00Z"}]'::jsonb),
      ($1,$2,$3,'contact_changed','attention','Hidden','Hidden','hidden-a','snoozed','2026-08-26T12:00:00Z',null,'2026-08-25T11:00:00Z','[]'::jsonb)`,
      [db.watchId, db.ids.organizationId, db.ids.bookingId]);

    const visible = await db.repository.listVisible(NOW);
    expect(visible.map((item) => item.title)).toEqual(["Deadline soon", "Verify power"]);
    expect(visible[0]).toMatchObject({
      profileName: "Twin Falls County Fair",
      severity: "urgent",
      sources: [expect.objectContaining({ url: "https://example.org/fair" })],
    });

    const infoId = visible.find((item) => item.title === "Verify power")!.id;
    expect(await db.repository.snooze(infoId, new Date("2026-09-01T12:00:00Z"))).toBe(true);
    expect(await db.repository.snooze("90000000-0000-4000-8000-000000000001", new Date("2026-09-01T12:00:00Z"))).toBe(false);

    const urgentId = visible.find((item) => item.title === "Deadline soon")!.id;
    expect(await db.repository.dismiss(urgentId)).toBe(true);
    expect(await db.repository.dismiss("90000000-0000-4000-8000-000000000001")).toBe(false);
    expect(await db.repository.listVisible(NOW)).toEqual([]);
  });
});
