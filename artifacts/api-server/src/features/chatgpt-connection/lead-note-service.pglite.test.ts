import { beforeEach, afterEach, it, expect } from "vitest";
import { fixture } from "./test-database";
import { LeadNoteService } from "./lead-note-service";
let f: Awaited<ReturnType<typeof fixture>>, service: LeadNoteService;
const source = {
  url: "https://fair.example/about",
  retrievedAt: "2026-09-30T12:00:00Z",
  eventYear: 2027,
  claim: "Event listed; organizer not verified",
  verification: "unverified" as const,
};
const lead = {
  name: "New Fair",
  city: "Town",
  region: "UT",
  officialWebsite: "https://fair.example",
  sourceIdentity: "https://fair.example/about",
  eventYear: 2026,
  sources: [source],
};
beforeEach(async () => {
  f = await fixture();
  service = new LeadNoteService(f.db);
});
afterEach(async () => f.db.close());
it("reuses stable identity across years and never invents organizer contacts", async () => {
  const first = await service.createLead(
    f.principal,
    { requestKey: "one" },
    lead,
  );
  const next = await service.createLead(
    f.principal,
    { requestKey: "two" },
    { ...lead, eventYear: 2027 },
  );
  expect(next.recordId).toBe(first.recordId);
  expect((await f.db.query("SELECT * FROM contacts")).rows).toHaveLength(0);
  expect(
    (await f.db.query("SELECT * FROM organizations WHERE name='New Fair'"))
      .rows,
  ).toHaveLength(1);
});
it("returns duplicate candidates for ambiguous names and distinguishes events on one municipal domain", async () => {
  await expect(
    service.createLead(
      f.principal,
      { requestKey: "ambiguous" },
      {
        ...lead,
        name: "County Fair",
        officialWebsite: null,
        sourceIdentity: null,
      },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_DUPLICATE_CANDIDATE" });
  const a = await service.createLead(
    f.principal,
    { requestKey: "a" },
    { ...lead, sourceIdentity: null },
  );
  const b = await service.createLead(
    f.principal,
    { requestKey: "b" },
    { ...lead, name: "Town Christmas", sourceIdentity: null },
  );
  expect(a.recordId).not.toBe(b.recordId);
});
it("saves provenance once and rejects unsafe sources without changing the profile", async () => {
  const input = {
    profileId: f.profileId,
    subject: "2027 research",
    body: "Organizer unknown",
    sources: [source],
  };
  const saved = await service.appendNote(
    f.principal,
    { requestKey: "note" },
    input,
  );
  expect(
    await service.appendNote(f.principal, { requestKey: "note" }, input),
  ).toEqual(saved);
  const rows = await f.db.query<{ body: string }>(
    "SELECT body FROM activities",
  );
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].body).toContain("unverified");
  expect(rows.rows[0].body).toContain(source.url);
  await expect(
    service.appendNote(
      f.principal,
      { requestKey: "bad" },
      { ...input, sources: [{ ...source, url: "file:///secret" }] },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_INVALID_SOURCE" });
  await expect(
    service.appendNote(
      f.principal,
      { requestKey: "date" },
      { ...input, sources: [{ ...source, retrievedAt: "yesterday" }] },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_INVALID_SOURCE" });
});
it("reuses an event-specific stable source when names and locations are corrected", async () => {
  const first = await service.createLead(
    f.principal,
    { requestKey: "original" },
    {
      ...lead,
      name: "Harvest Celebration",
      sourceIdentity: "https://civic.example/events/42",
    },
  );
  const next = await service.createLead(
    f.principal,
    { requestKey: "corrected" },
    {
      ...lead,
      name: "Autumn Festival",
      city: "Corrected Town",
      sourceIdentity: "https://civic.example/events/42",
    },
  );
  expect(next.recordId).toBe(first.recordId);
});

it("keeps distinct event IDs in source query parameters", async () => {
  const a = await service.createLead(
    f.principal,
    { requestKey: "query-a" },
    { ...lead, sourceIdentity: "https://civic.example/event?id=42" },
  );
  const b = await service.createLead(
    f.principal,
    { requestKey: "query-b" },
    {
      ...lead,
      name: "Other Festival",
      sourceIdentity: "https://civic.example/event?id=43",
    },
  );
  expect(a.recordId).not.toBe(b.recordId);
});

it("saves calendar date facts atomically and holds conflicting dates for review", async () => {
 const { readFile } = await import("node:fs/promises");
 await f.db.exec(await readFile(new URL("../../../../../lib/db/migrations/20260921_event_date_coverage.sql", import.meta.url),"utf8"));
 const dates = {startsOn:"2027-05-13",endsOn:"2027-05-16",status:"confirmed" as const,sourceUrl:source.url,rationale:"Official website publishes the 2027 dates."};
 const sources = [{...source,verification:"verified" as const}];
 const saved = await service.createLead(f.principal,{requestKey:"dated"},{...lead,eventYear:2027,sources,eventDates:dates,summary:"Family festival. Organizer contact unknown."});
 const rows = await f.db.query("SELECT *,starts_on::text AS starts_on,ends_on::text AS ends_on FROM event_date_facts WHERE organization_id=$1",[saved.recordId]);
 expect(rows.rows).toHaveLength(1);
 expect(rows.rows[0]).toMatchObject({status:"confirmed",active:true,starts_on:"2027-05-13",ends_on:"2027-05-16"});
 await service.appendNote(f.principal,{requestKey:"conflict"},{profileId:saved.recordId,subject:"Dates",body:"Conflicting published dates need checking.",sources,eventDates:{...dates,startsOn:"2027-05-14"}});
 expect((await f.db.query("SELECT status,active FROM event_date_facts ORDER BY created_at,id")).rows).toEqual(expect.arrayContaining([{status:"confirmed",active:true},{status:"needs_review",active:false}]));
 expect((await f.db.query("SELECT * FROM bookings")).rows).toHaveLength(0);
});
