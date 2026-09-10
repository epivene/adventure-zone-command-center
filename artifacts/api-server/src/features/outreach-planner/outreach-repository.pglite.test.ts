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
const qualificationCriteria = {
  startsOn: "2026-12-01",
  endsOn: "2026-12-10",
  quantities: { zone: 1 },
  geography: {
    latitude: 40,
    longitude: -80,
    radiusMiles: 100,
    adjacentRegions: ["OH"],
  },
};
const provenance = {
  checkedAt: "2026-09-29T18:00:00Z",
  dateConfidence: "unknown",
  contactConfidence: "unknown",
  fitConfidence: "unknown",
};
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
create table booking_opportunities(id uuid primary key default gen_random_uuid(),organization_id uuid references organizations(id),event_year integer not null,booking_id uuid,contact_id uuid,status text default 'ready_to_contact',priority text default 'normal',next_action_kind text,next_action_due_at timestamptz,hold_reason text,email_automation_protected boolean default false,territory_exception_approved boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(), unique(organization_id,event_year));
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
  await client.exec(`
    alter table travel_legs add archived_at timestamptz;
    alter table package_templates add name text default 'Zone', add active boolean default true;
    insert into package_templates(id,code,normal_capacity,temporary_unavailable_quantity) values ('${randomUUID()}','zone',1,0);
    alter table organizations add consolidated_into_id uuid, add filler boolean default false,add filler_reason text;
    alter table bookings add organization_id uuid,add primary_contact_id uuid,add name text default 'Event';
    create table contacts(id uuid primary key,email text);
    create table communication_blocks(id uuid primary key default gen_random_uuid(),active boolean default true,target_type text,organization_id uuid,contact_id uuid,normalized_email text,reason text);
    create table convention_editions(id uuid primary key,year integer);
    create table convention_members(id uuid primary key,edition_id uuid,organization_id uuid);
    create table office_email_drafts(id uuid primary key,organization_id uuid,booking_id uuid,event_year integer,subject text,recipient_email text,state text);
    alter table booking_opportunity_email_state add organization_id uuid,add subject text,add recipient_email text;
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
  await client.exec(
    await readFile(
      "../../lib/db/migrations/20260910_outreach_workspace.sql",
      "utf8",
    ),
  );
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
    "insert into booking_opportunity_email_state(id,opportunity_id,event_year,state,sent_at,gmail_message_id,purpose) values ($1,$2,2026,$3,$4,$5,$6)",
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
      { criteria: "County fairs", qualificationCriteria },
      "owner",
    );
    const b = await service.research(
      c.openingId,
      { criteria: " County fairs ", qualificationCriteria },
      "owner",
    );
    expect(a.id).toBe(b.id);
    expect(a.qualificationCriteria?.startsOn).toBe(window.startsOn);
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
              ...provenance,
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
      { criteria: "Festival", qualificationCriteria },
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
            ...provenance,
          },
        ],
      },
      "owner",
    );
    expect(result.status).toBe("pending");
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

describe("workspace lifecycle", () => {
  it("binds an undated opportunity to its verified event without replacing its history", async () => {
    const { client, service } = await setup();
    const profile = randomUUID(), opportunity = randomUUID(), book = randomUUID(), emailState = randomUUID();
    await client.query("insert into organizations(id,name) values ($1,$2)", [profile, "Matched Festival"]);
    await client.query("insert into bookings(id,organization_id,starts_at,ends_at,name,primary_contact_id) values ($1,$2,$3,$4,$5,null)", [book, profile, "2026-11-06T15:00:00Z", "2026-11-08T23:00:00Z", "Matched Festival 2026"]);
    await client.query("insert into booking_opportunities(id,organization_id,event_year,booking_id,next_action_kind,next_action_due_at) values ($1,$2,2026,null,'callback',$3)", [opportunity, profile, "2026-10-01T15:00:00Z"]);
    await client.query("insert into booking_opportunity_email_state(id,opportunity_id,event_year,state,subject) values ($1,$2,2026,'draft','Existing convention follow-up')", [emailState, opportunity]);

    const result = await service.bindOpportunity(
      opportunity,
      { bookingId: book, confirmedEventYear: 2026, reason: "I verified the profile, event dates, and matching event identity." },
      "owner",
    );

    expect(result).toMatchObject({ opportunityId: opportunity, bookingId: book, eventYear: 2026, reused: false });
    expect((await client.query("select booking_id,next_action_kind,next_action_due_at from booking_opportunities where id=$1", [opportunity])).rows[0]).toMatchObject({ booking_id: book, next_action_kind: "callback" });
    expect((await client.query("select opportunity_id,subject from booking_opportunity_email_state where id=$1", [emailState])).rows[0]).toMatchObject({ opportunity_id: opportunity, subject: "Existing convention follow-up" });
    expect((await client.query("select action from outreach_audit where entity_id=$1", [opportunity])).rows).toContainEqual({ action: "bind_opportunity_booking" });

    const repeated = await service.bindOpportunity(opportunity, { bookingId: book, confirmedEventYear: 2026, reason: "I rechecked the same identity." }, "owner");
    expect(repeated.reused).toBe(true);
    await expect(service.bindOpportunity(opportunity, { bookingId: booking, confirmedEventYear: 2026, reason: "Try a different event." }, "owner")).rejects.toThrow("already linked");
  });

  it("admits a scouted profile repeat-safely and refuses different booking identity without changing manual work", async () => {
    const { client, service } = await setup();
    const profile = randomUUID(),
      book = randomUUID();
    await client.exec(
      `insert into organizations(id,name) values ('${profile}','Scouted Festival'); insert into bookings(id,organization_id,starts_at,ends_at) values ('${book}','${profile}','2026-12-03T18:00Z','2026-12-05T18:00Z');`,
    );
    const choices = await service.searchProfiles({ q: "Scouted", year: 2026 });
    expect(choices[0].bookings[0].id).toBe(book);
    const input = {
      organizationId: choices[0].organizationId,
      eventYear: 2026,
      bookingId: book,
      reason: "Owner matched saved Scout profile and dates",
    };
    const a = await service.admitProfile(input, "owner"),
      b = await service.admitProfile(input, "owner");
    expect(a.opportunityId).toBe(b.opportunityId);
    expect(b.reused).toBe(true);
    const opening = await service.createOpening(window, "owner");
    await service.createCandidate(
      { openingId: opening.id, opportunityId: a.opportunityId },
      "owner",
    );
    const c = (await service.get()).candidates[0];
    expect(c).toMatchObject({
      organizationId: profile,
      bookingId: book,
      eventStartsAt: "2026-12-03T18:00:00.000Z",
    });
    await client.exec(
      `update booking_opportunities set next_action_kind='callback',next_action_due_at='2026-10-01' where id='${a.opportunityId}';`,
    );
    await expect(
      service.admitProfile({ ...input, bookingId: null }, "owner"),
    ).rejects.toThrow("Identity review");
    expect(
      (
        await client.query(
          `select next_action_kind from booking_opportunities where id='${a.opportunityId}'`,
        )
      ).rows[0],
    ).toMatchObject({ next_action_kind: "callback" });
    expect(
      (await client.query(`select id from organizations where id='${profile}'`))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await client.query(
          `select id from booking_opportunities where organization_id='${profile}'`,
        )
      ).rows,
    ).toHaveLength(1);
    const next = await service.admitProfile(
      {
        organizationId: profile,
        eventYear: 2027,
        reason: "Next-year prospect",
      },
      "owner",
    );
    expect(next.bookingId).toBeNull();
  });
  it("exposes real catalogs and contextual suggestions while guarding profile, year and exact contact identity", async () => {
    const { client, service } = await setup();
    const profile = randomUUID(),
      book = randomUUID(),
      contact = randomUUID(),
      edition = randomUUID();
    await client.exec(
      `update organizations set filler=true,filler_reason='Local filler option' where id='${org}';insert into convention_editions values ('${edition}',2025);insert into convention_members values ('${randomUUID()}','${edition}','${org}');insert into contacts values ('${contact}','Blocked@Example.com');update booking_opportunities set contact_id='${contact}' where id='${op}';insert into organizations(id,name) values ('${profile}','Other profile');insert into bookings(id,organization_id,starts_at,ends_at,name) values ('${book}','${profile}','2026-12-03T18:00Z','2026-12-04T18:00Z','Other event');`,
    );
    const pick = (
      await service.searchOpportunities({ q: "Fest", year: 2026 })
    )[0];
    expect(pick.suggestions.map((s) => s.tier)).toEqual([
      "filler",
      "convention",
    ]);
    expect(pick.suggestions[1].conventionYear).toBe(2025);
    await expect(
      service.admitProfile(
        {
          organizationId: org,
          eventYear: 2026,
          bookingId: book,
          reason: "wrong profile",
        },
        "owner",
      ),
    ).rejects.toThrow("Identity review");
    await expect(
      service.admitProfile(
        {
          organizationId: profile,
          eventYear: 2027,
          bookingId: book,
          reason: "wrong year",
        },
        "owner",
      ),
    ).rejects.toThrow("Identity review");
    const catalog = await service.get();
    expect(catalog.legs[0]).toMatchObject({ name: "Leg 1", active: true });
    expect(catalog.packages[0]).toMatchObject({ name: "Zone", active: true });
    const recovery = await service.recoveryCatalog({ q: "Other" });
    expect(recovery.bookings[0]).toMatchObject({
      id: book,
      organizationId: profile,
      organizationName: "Other profile",
      name: "Other event",
    });
    await client.exec(
      `insert into communication_blocks(target_type,normalized_email,reason) values ('recipient_email','blocked@example.com','No email');`,
    );
    await expect(
      service.admitProfile(
        { organizationId: org, eventYear: 2026, reason: "Keep existing" },
        "owner",
      ),
    ).rejects.toThrow("DO NOT SEND");
    const opening = await service.createOpening(window, "owner");
    await expect(
      service.createCandidate(
        {
          openingId: opening.id,
          opportunityId: op,
          tier: "convention",
          reason: "Convention context",
        },
        "owner",
      ),
    ).rejects.toThrow("DO NOT SEND");
    await client.exec(
      `update organizations set consolidated_into_id='${org}' where id='${profile}'`,
    );
    expect(
      await service.searchProfiles({ q: "Other", year: 2026 }),
    ).toHaveLength(0);
    await expect(
      service.admitProfile(
        { organizationId: profile, eventYear: 2026, reason: "retired" },
        "owner",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("audits cadence/snooze prose and preserves callback urgency using actual event dates", async () => {
    const { client, service } = await setup();
    const c = await candidate(service);
    await client.exec(
      `insert into bookings(id,starts_at,ends_at) values ('${booking}','2026-10-10T18:00Z','2026-10-11T18:00Z');`,
    );
    await service.reviewHistory(
      c.id,
      { reason: "Reviewed all inbound history" },
      "owner",
    );
    await service.patchCandidate(
      c.id,
      {
        snoozedUntil: "2026-11-01T18:00:00Z",
        cadenceOverride: {
          days: [2, 4, 6],
          minimumGapDays: 2,
          reason: "Owner timeline decision",
        },
        reason: "Check again next month",
      },
      "owner",
    );
    expect((await service.get()).candidates[0].outreach.reason).toContain(
      "within 45 days",
    );
    await client.exec(
      `update booking_opportunities set next_action_kind='callback',next_action_due_at='2026-09-29' where id='${op}';`,
    );
    expect((await service.get()).candidates[0].outreach.state).toBe("decision");
    const activities = (
      await client.query<{ body: string }>("select body from activities")
    ).rows;
    expect(
      activities.some((a) => a.body.includes("Reason: Check again next month")),
    ).toBe(true);
    expect(activities.every((a) => !a.body.includes("{"))).toBe(true);
    await expect(
      client.exec(
        `update outreach_candidates set cadence_override='{"days":[1,1,2],"minimumGapDays":1,"reason":"bad"}'`,
      ),
    ).rejects.toThrow();
  });
  it("merges researched backups with qualified distinct counts and preserves earlier results", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    const task = await service.research(
      c.openingId,
      { criteria: "Adjacent fairs", qualificationCriteria, targetCount: 2 },
      "owner",
    );
    const result = {
      opportunityId: op,
      sourceUrl: "https://example.org/fair",
      note: "Owner checked source",
      checkedAt: now.toISOString(),
      dateConfidence: "verified",
      contactConfidence: "verified",
      fitConfidence: "verified",
      startsOn: "2026-12-02",
      endsOn: "2026-12-04",
      contact: "contact@example.org",
      quantities: { zone: 1 },
      latitude: 40,
      longitude: -80,
    };
    const a = await service.saveResearchResults(
      task.id,
      { results: [result] },
      "owner",
    );
    expect(a.status).toBe("pending");
    expect(a.results?.[0].qualified).toBe(true);
    const again = await service.saveResearchResults(
      task.id,
      { results: [result] },
      "owner",
    );
    expect(again.results).toHaveLength(1);
    const other = randomUUID(),
      profile = randomUUID();
    await client.exec(
      `insert into organizations(id,name) values ('${profile}','Second Fair');insert into booking_opportunities(id,organization_id,event_year) values ('${other}','${profile}',2026)`,
    );
    const partial = await service.saveResearchResults(
      task.id,
      {
        results: [
          {
            ...result,
            opportunityId: other,
            sourceUrl: "https://example.org/other",
            contactConfidence: "unknown",
          },
        ],
      },
      "owner",
    );
    expect(partial.results).toHaveLength(2);
    expect(partial.status).toBe("pending");
    const done = await service.saveResearchResults(
      task.id,
      {
        results: [
          {
            ...result,
            opportunityId: other,
            sourceUrl: "https://example.org/other",
          },
        ],
      },
      "owner",
    );
    expect(done.status).toBe("completed");
    expect(done.results).toHaveLength(2);
    await service.setOpeningStatus(
      c.openingId,
      { status: "filled", reason: "Gap filled" },
      "owner",
    );
    await expect(
      service.saveResearchResults(task.id, { results: [result] }, "owner"),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.get()).researchTasks[0].results).toHaveLength(2);
  });
  it("repairs each workspace object independently and preserves candidate/research data", async () => {
    const { service, client } = await setup();
    const c = await candidate(service);
    const t = await service.research(
      c.openingId,
      { criteria: "Fairs", qualificationCriteria },
      "owner",
    );
    const migration = await readFile(
      "../../lib/db/migrations/20260910_outreach_workspace.sql",
      "utf8",
    );
    const entry = (await loadActReviewMigrations()).find(
      (m) => m.name === "20260910_outreach_workspace.sql",
    )!;
    await client.exec(
      `update outreach_research_tasks set qualification_criteria=null,status='completed',results='[{"opportunityId":"${op}","sourceUrl":"https://example.org/legacy","note":"Legacy preserved"}]' where id='${t.id}'`,
    );
    await client.exec(
      "alter table outreach_candidates drop column snoozed_until; alter table outreach_research_tasks drop constraint outreach_research_target_valid; drop index if exists outreach_candidates_snoozed_idx; drop function outreach_valid_cadence(jsonb) cascade;",
    );
    expect(
      (await client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
    ).toBe(false);
    await client.exec(migration);
    await client.exec(migration);
    expect(
      (await client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
    ).toBe(true);
    expect((await service.get()).candidates[0].id).toBe(c.id);
    expect((await service.get()).researchTasks[0].id).toBe(t.id);
    expect((await service.get()).researchTasks[0]).toMatchObject({
      status: "pending",
      results: [{ note: "Legacy preserved" }],
    });
  });
});
