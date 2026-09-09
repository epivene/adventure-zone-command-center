import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { OutreachRepository } from "./outreach-repository";
import { OutreachService } from "./outreach-service";
import { loadActReviewMigrations } from "@workspace/db/migrations";
const clients: PGlite[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});
const org = "10000000-0000-4000-8000-000000000001",
  op = "20000000-0000-4000-8000-000000000001",
  leg = "30000000-0000-4000-8000-000000000001",
  booking = "40000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-30T18:00:00Z");
const window = {
  title: "Winter",
  eventYear: 2026,
  startsOn: "2026-12-01",
  endsOn: "2026-12-10",
  legId: leg,
  quantities: { zone: 1 },
};
async function setup() {
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
create table travel_legs(id uuid primary key,name text);
create table organizations(id uuid primary key,name text,last_resort boolean default false);
create table bookings(id uuid primary key,starts_at timestamptz,ends_at timestamptz,status text,probability text,travel_leg_id uuid);
create table booking_opportunities(id uuid primary key,organization_id uuid references organizations(id),event_year integer not null,booking_id uuid,contact_id uuid,status text default 'ready_to_contact',priority text default 'normal',next_action_kind text,next_action_due_at timestamptz,hold_reason text,email_automation_protected boolean default false,territory_exception_approved boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(), unique(organization_id,event_year));
create table package_templates(id uuid primary key,code text,normal_capacity integer,temporary_unavailable_quantity integer);
create table follow_ups(id uuid primary key,organization_id uuid,booking_id uuid,contact_id uuid,kind text,due_at timestamptz,completed_at timestamptz);
create table booking_opportunity_email_state(id uuid primary key,opportunity_id uuid,event_year integer,state text,sent_at timestamptz,gmail_message_id text,purpose text);
create table call_sessions(id uuid primary key,organization_id uuid,booking_id uuid,ended_at timestamptz,direction text,disposition text,contact_id uuid);
create table boss_convention_submissions(id uuid primary key,applied_at timestamptz,applied_organization_id uuid,applied_contact_id uuid);
create table booking_operational_windows(booking_id uuid,starts_at timestamptz,ends_at timestamptz);
create table booking_package_selections(booking_id uuid,package_template_id uuid);
create table google_operational_calendar_links(id uuid,booking_id uuid,calendar_id text,google_event_id text,package_key text,reserved_starts_at timestamptz,reserved_ends_at timestamptz,last_synced_at timestamptz,last_error_code text);
create table google_workspace_validation_mappings(message_id text,organization_id uuid,updated_at timestamptz);
create table activities(id uuid primary key default gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,subject text,status text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,date_is_import_fallback boolean default false,ends_at timestamptz,act_record_id text,source_record_id uuid,source_version_id uuid,source_type text,organization_location_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
insert into travel_legs values ('${leg}','Leg 1');insert into organizations values ('${org}','Festival',false);insert into booking_opportunities(id,organization_id,event_year,booking_id) values ('${op}','${org}',2026,'${booking}');
`);
  const migration = await readFile(
    "../../lib/db/migrations/20260909_outreach_planner.sql",
    "utf8",
  );
  await client.exec(migration);
  await client.exec(migration);
  const entry = (await loadActReviewMigrations()).find(
    (x) => x.name === "20260909_outreach_planner.sql",
  )!;
  expect(
    (await client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
  ).toBe(true);
  const repo = new OutreachRepository(drizzle(client) as never);
  const service = new OutreachService(
    repo,
    () => true,
    () => now,
  );
  return { client, service, repo };
}
async function candidate(service: OutreachService) {
  const o = await service.createOpening(window, "owner");
  return service.createCandidate(
    { openingId: o.id, opportunityId: op, tier: "strong" },
    "owner",
  );
}
async function email(
  client: PGlite,
  id: string,
  at: string,
  purpose = "new_outreach",
  state = "sent",
) {
  await client.query(
    "insert into booking_opportunity_email_state values ($1,$2,2026,$3,$4,$5,$6)",
    [randomUUID(), op, state, at, id, purpose],
  );
}
describe("persistent planner", () => {
  it("runs migration twice, saves edits, audits profile and preserves manual/promo steps", async () => {
    const { service, client } = await setup();
    await client.exec(
      `update booking_opportunities set next_action_kind='callback',next_action_due_at='2026-10-01';insert into follow_ups values ('${randomUUID()}','${org}',null,null,'early_bird_promo','2026-10-02',null)`,
    );
    const c = await candidate(service);
    await service.patchCandidate(
      c.id,
      {
        tier: "filler",
        decisionDueAt: "2026-10-03T18:00:00Z",
        reason: "Owner decision",
      },
      "owner",
    );
    const x = (await service.get()).candidates[0];
    expect(x.tier).toBe("filler");
    expect(x.sources.manualNextActions.map((x) => x.kind)).toEqual([
      "callback",
      "early_bird_promo",
    ]);
    expect(x.capacity.status).toBe("needs_review");
    expect((await client.query("select * from activities")).rows).toHaveLength(
      2,
    );
    expect(
      (await client.query("select * from outreach_audit")).rows,
    ).toHaveLength(3);
  });
  it("rejects duplicate membership/cross-opening pursuit and rolls failed writes back", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    await expect(
      service.createCandidate(
        { openingId: c.openingId, opportunityId: op },
        "owner",
      ),
    ).rejects.toMatchObject({ status: 409 });
    const o = await service.createOpening(
      { ...window, title: "Other" },
      "owner",
    );
    await expect(
      service.createCandidate({ openingId: o.id, opportunityId: op }, "owner"),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await client.query("select * from outreach_candidates")).rows,
    ).toHaveLength(1);
  });
  it("rejects invalid dates/year/rank, unknown and wrong-year profiles", async () => {
    const { service, client } = await setup();
    await expect(
      service.createOpening({ ...window, startsOn: "2026-02-30" }, "owner"),
    ).rejects.toBeDefined();
    const o = await service.createOpening(window, "owner");
    await expect(
      service.createCandidate(
        { openingId: o.id, opportunityId: randomUUID() },
        "owner",
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.createCandidate(
        { openingId: o.id, opportunityId: op, manualRank: -1 },
        "owner",
      ),
    ).rejects.toBeDefined();
    await client.exec(`update booking_opportunities set event_year=2027`);
    await expect(
      service.createCandidate({ openingId: o.id, opportunityId: op }, "owner"),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      client.exec(
        `insert into outreach_openings(title,event_year,starts_on,ends_on,quantities) values ('bad',2025,'2026-01-01','2026-01-02','{}')`,
      ),
    ).rejects.toBeDefined();
  });
  it("links successful real sends only; prevents replay/stage inflation/reranking", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    await email(client, "draft", "2026-09-01", "new_outreach", "draft");
    await expect(
      service.recordAttempt(
        c.id,
        { sourceId: "gmail:draft", stage: "initial" },
        "owner",
      ),
    ).rejects.toMatchObject({ status: 409 });
    await email(client, "real", "2026-09-01");
    await service.recordAttempt(
      c.id,
      { sourceId: "gmail:real", stage: "initial" },
      "owner",
    );
    await expect(
      service.recordAttempt(
        c.id,
        { sourceId: "gmail:real", stage: "follow_up_1" },
        "owner",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.get()).candidates[0].attempts).toHaveLength(1);
    await expect(
      service.patchCandidate(c.id, { manualRank: 0, reason: "Jump" }, "owner"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps active pursuit ahead of newly inserted higher tier", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    await email(client, "real", "2026-09-01");
    await service.recordAttempt(
      c.id,
      { sourceId: "gmail:real", stage: "initial" },
      "owner",
    );
    const other = randomUUID(),
      otherOrg = randomUUID();
    await client.query(
      "insert into organizations(id,name) values ($1,'Other Festival')",
      [otherOrg],
    );
    await client.query(
      "insert into booking_opportunities(id,organization_id,event_year) values ($1,$2,2026)",
      [other, otherOrg],
    );
    const second = await service.createCandidate(
      { openingId: c.openingId, opportunityId: other, tier: "dedicated" },
      "owner",
    );
    expect(
      (await service.get()).candidates.find((x) => x.id === second.id)
        ?.waitingForCandidateId,
    ).toBe(c.id);
  });
  it("requires history review to advance and invalidates it on new stored email evidence", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    for (const [id, at, stage] of [
      ["one", "2026-09-01", "initial"],
      ["two", "2026-09-08", "follow_up_1"],
      ["three", "2026-09-15", "follow_up_2"],
    ]) {
      await email(
        client,
        id,
        at,
        stage === "initial" ? "new_outreach" : "follow_up",
      );
      await service.recordAttempt(
        c.id,
        { sourceId: `gmail:${id}`, stage },
        "owner",
      );
    }
    await expect(service.advance(c.id, "owner")).rejects.toMatchObject({
      status: 409,
    });
    await service.reviewHistory(
      c.id,
      { reason: "Reviewed mailbox and calls; no reply" },
      "owner",
    );
    expect((await service.get()).candidates[0].sources.reviewReasons).toEqual(
      [],
    );
    await client.query(
      "insert into google_workspace_validation_mappings values ($1,$2,$3)",
      ["new-inbound", org, "2026-09-30"],
    );
    await expect(service.advance(c.id, "owner")).rejects.toMatchObject({
      status: 409,
    });
    await service.reviewHistory(
      c.id,
      { reason: "Reviewed new email; bounce only" },
      "owner",
    );
    expect((await service.check(c.id, "owner")).capacity.status).toBe(
      "needs_review",
    );
    await service.advance(c.id, "owner");
    expect((await service.get()).candidates[0].releasedAt).toBe(
      now.toISOString(),
    );
  });
  it("distinguishes outgoing silent calls, convention provenance and manually classified tier", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    for (const [direction, disposition, bookingId] of [
      ["incoming", "no_answer", booking],
      ["outgoing", "wrong_number", booking],
      ["outgoing", "left_voicemail", null],
      ["outgoing", "left_voicemail", booking],
    ])
      await client.query(
        "insert into call_sessions(id,organization_id,booking_id,ended_at,direction,disposition) values ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), org, bookingId, "2026-09-01", direction, disposition],
      );
    await service.patchCandidate(
      c.id,
      { tier: "convention", reason: "Met at convention; end date unknown" },
      "owner",
    );
    const x = (await service.get()).candidates[0];
    expect(x.sources.choices.filter((s) => s.eligible)).toHaveLength(1);
    expect(x.conventionEndsOn).toBeNull();
    expect(x.outreach.state).toBe("needs_review");
    await client.query(
      "insert into boss_convention_submissions values ($1,$2,$3,null)",
      [randomUUID(), "2026-09-01", org],
    );
    expect(
      (await service.sources(c.id)).choices.some(
        (s) => s.kind === "convention",
      ),
    ).toBe(true);
  });
  it("preserves meaningful reply; derives idempotent research and pauses it on fill", async () => {
    const { service } = await setup();
    const c = await candidate(service);
    await service.patchCandidate(
      c.id,
      { meaningfulReplyAt: "2026-09-29T18:00:00Z", reason: "Actual interest" },
      "owner",
    );
    expect((await service.get()).candidates[0].outreach.state).toBe("reply");
    const a = await service.research(
      c.openingId,
      { criteria: "County fairs" },
      "owner",
    );
    const b = await service.research(
      c.openingId,
      { criteria: " County fairs " },
      "owner",
    );
    expect(a.id).toBe(b.id);
    expect(a.criteria).toContain(window.startsOn);
    await service.setOpeningStatus(
      c.openingId,
      { status: "filled", reason: "Booked" },
      "owner",
    );
    expect((await service.get()).researchTasks[0].status).toBe("paused");
    await expect(
      service.saveResearchResults(
        a.id,
        {
          results: [
            {
              opportunityId: op,
              sourceUrl: "https://example.org",
              note: "Verified event year",
            },
          ],
        },
        "owner",
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("accepts research provenance and exposes opportunity search", async () => {
    const { service } = await setup();
    const c = await candidate(service);
    const task = await service.research(
      c.openingId,
      { criteria: "Festival" },
      "owner",
    );
    const result = await service.saveResearchResults(
      task.id,
      {
        results: [
          {
            opportunityId: op,
            sourceUrl: "https://example.org",
            note: "Verified event year",
          },
        ],
      },
      "owner",
    );
    expect(result.status).toBe("completed");
    expect(
      (await service.searchOpportunities({ q: "Fest", year: 2026 }))[0].id,
    ).toBe(op);
  });
  it("never touches repository when disabled", async () => {
    const service = new OutreachService(
      new Proxy({} as OutreachRepository, {
        get() {
          throw new Error("Database touched");
        },
      }),
      () => false,
    );
    expect((await service.get()).enabled).toBe(false);
    await expect(service.createOpening(window, "owner")).rejects.toMatchObject({
      status: 404,
    });
  });
  it("requires explicit year confirmation for profile-only calls and preserves observed interest", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    const id = randomUUID();
    await client.query(
      "insert into call_sessions(id,organization_id,booking_id,ended_at,direction,disposition) values ($1,$2,null,$3,$4,$5)",
      [id, org, "2026-09-01", "outgoing", "left_voicemail"],
    );
    await expect(
      service.recordAttempt(
        c.id,
        { sourceId: `call:${id}`, stage: "initial" },
        "owner",
      ),
    ).rejects.toMatchObject({ status: 409 });
    await service.recordAttempt(
      c.id,
      {
        sourceId: `call:${id}`,
        stage: "initial",
        confirmedEventYear: 2026,
        reason: "Owner confirms call discussed 2026 event",
      },
      "owner",
    );
    await client.query(
      "insert into call_sessions(id,organization_id,booking_id,ended_at,direction,disposition) values ($1,$2,$3,$4,$5,$6)",
      [randomUUID(), org, booking, "2026-09-02", "incoming", "interested"],
    );
    await service.reviewHistory(
      c.id,
      { reason: "Reviewed latest conversation" },
      "owner",
    );
    expect((await service.get()).candidates[0].outreach.state).toBe("reply");
  });
  it.each(["contact", "booking"])(
    "invalidates reviewed cadence on new %s-only activity, including ordinary planner-titled notes",
    async (parent) => {
      const { service, client } = await setup();
      const c = await candidate(service);
      const contact = randomUUID();
      await client.query(
        "update booking_opportunities set contact_id=$1 where id=$2",
        [contact, op],
      );
      for (const [id, at, stage] of [
        ["initial", "2026-09-01", "initial"],
        ["first", "2026-09-08", "follow_up_1"],
        ["second", "2026-09-15", "follow_up_2"],
      ]) {
        await email(
          client,
          id,
          at,
          stage === "initial" ? "new_outreach" : "follow_up",
        );
        await service.recordAttempt(
          c.id,
          { sourceId: `gmail:${id}`, stage },
          "owner",
        );
      }
      await service.reviewHistory(
        c.id,
        { reason: "Reviewed earlier history" },
        "owner",
      );
      expect((await service.get()).candidates[0].outreach.state).toBe(
        "advance",
      );
      await client.query(
        "insert into activities(contact_id,booking_id,kind,subject,body,occurred_at,timeline_sort_at) values ($1,$2,'note','Outreach planner','Customer expressed interest','2026-09-29','2026-09-29')",
        [
          parent === "contact" ? contact : null,
          parent === "booking" ? booking : null,
        ],
      );
      expect((await service.get()).candidates[0].outreach.state).toBe(
        "needs_review",
      );
      await expect(service.advance(c.id, "owner")).rejects.toMatchObject({
        status: 409,
      });
      expect((await service.get()).candidates[0].releasedAt).toBeNull();
    },
  );
  it("invalidates history on contact-only completed calls without assuming their event year", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    const contact = randomUUID();
    await client.query(
      "update booking_opportunities set contact_id=$1 where id=$2",
      [contact, op],
    );
    await service.reviewHistory(
      c.id,
      { reason: "Reviewed prior calls" },
      "owner",
    );
    const id = randomUUID();
    await client.query(
      "insert into call_sessions(id,contact_id,ended_at,direction,disposition) values ($1,$2,'2026-09-29','incoming','interested')",
      [id, contact],
    );
    const x = (await service.get()).candidates[0];
    expect(x.sources.historyFingerprint).not.toBe(x.historyReview?.fingerprint);
    expect(x.sources.choices.find((s) => s.id === `call:${id}`)).toMatchObject({
      kind: "incoming_call",
      eligible: false,
    });
    expect(x.sources.observedInterestAt).toBeUndefined();
    expect(x.outreach.state).toBe("needs_review");
  });
  it.each(["decision", "opportunity", "follow_up"])(
    "preserves %s callback leadership and rerank protection",
    async (kind) => {
      const { service, client } = await setup();
      const c = await candidate(service);
      if (kind === "decision")
        await service.patchCandidate(
          c.id,
          {
            decisionDueAt: "2026-10-05T18:00:00Z",
            reason: "Promised callback",
          },
          "owner",
        );
      if (kind === "opportunity")
        await client.query(
          "update booking_opportunities set next_action_kind='callback',next_action_due_at='2026-10-05T18:00:00Z' where id=$1",
          [op],
        );
      if (kind === "follow_up")
        await client.query(
          "insert into follow_ups(id,booking_id,kind,due_at) values ($1,$2,'callback','2026-10-05T18:00:00Z')",
          [randomUUID(), booking],
        );
      const otherOrg = randomUUID(),
        otherOp = randomUUID();
      await client.query(
        "insert into organizations(id,name) values ($1,'Other Festival')",
        [otherOrg],
      );
      await client.query(
        "insert into booking_opportunities(id,organization_id,event_year) values ($1,$2,2026)",
        [otherOp, otherOrg],
      );
      const higher = await service.createCandidate(
        { openingId: c.openingId, opportunityId: otherOp, tier: "dedicated" },
        "owner",
      );
      const rows = (await service.get()).candidates;
      const callback = rows.find((x) => x.id === c.id)!;
      expect(callback.waitingForCandidateId).toBeNull();
      expect(rows.find((x) => x.id === higher.id)?.waitingForCandidateId).toBe(
        c.id,
      );
      expect(callback.outreach).toMatchObject({
        state: "waiting",
        dueAt: "2026-10-05T18:00:00.000Z",
        nextStage: null,
      });
      await expect(
        service.patchCandidate(
          higher.id,
          { manualRank: 0, reason: "Rank above callback" },
          "owner",
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.patchCandidate(
          c.id,
          { manualRank: 4, reason: "Move callback" },
          "owner",
        ),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it.each([
    "google_workspace_validation_mappings",
    "booking_opportunity_email_state",
  ])(
    "recovers SQL source failure at %s savepoint while preserving known blockers and callbacks",
    async (table) => {
      const { service, client } = await setup();
      const c = await candidate(service);
      await client.query(
        "update booking_opportunities set email_automation_protected=true,next_action_kind='callback',next_action_due_at='2026-10-05' where id=$1",
        [op],
      );
      await client.query(
        "insert into follow_ups(id,booking_id,kind,due_at) values ($1,$2,'early_bird_promo','2026-10-06')",
        [randomUUID(), booking],
      );
      await client.exec(`drop table ${table}`);
      const sources = await service.check(c.id, "owner");
      expect(sources.capacity.status).toBe("needs_review");
      expect(sources.historyFingerprint).toBe("unverified");
      expect(sources.protectedReason).toContain("Protected");
      expect(sources.manualNextActions.map((x) => x.kind)).toEqual([
        "callback",
        "early_bird_promo",
      ]);
      expect((await service.get()).candidates[0].checkedAt).toBe(
        now.toISOString(),
      );
      await expect(
        service.reviewHistory(
          c.id,
          { reason: "Cannot review unavailable source" },
          "owner",
        ),
      ).rejects.toMatchObject({ status: 409 });
      await service.patchCandidate(
        c.id,
        {
          decisionDueAt: "2026-10-07T18:00:00Z",
          reason: "Preserve owner planning despite source outage",
        },
        "owner",
      );
      expect((await service.get()).candidates[0].decisionDueAt).toBe(
        "2026-10-07T18:00:00.000Z",
      );
      expect(
        (await client.query("select count(*)::int as n from outreach_audit"))
          .rows[0],
      ).toMatchObject({ n: 4 });
    },
  );
});
