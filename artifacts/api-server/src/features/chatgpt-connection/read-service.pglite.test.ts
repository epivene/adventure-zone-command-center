import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { ConnectionReadService } from "./read-service";
let f: Awaited<ReturnType<typeof fixture>>, service: ConnectionReadService;
beforeEach(async () => {
  f = await fixture();
  service = new ConnectionReadService(f.db);
});
afterEach(async () => f.db.close());
it("bounds searches, follows stable cursors and excludes consolidated profiles", async () => {
  await f.db.exec(
    "INSERT INTO organizations(name) SELECT 'Fair '||n FROM generate_series(1,60) n",
  );
  const first = await service.search(f.principal, {
    query: "Fair",
    eventYear: 2027,
  });
  expect(first.items).toHaveLength(20);
  expect(first.truncated).toBe(true);
  const next = await service.search(f.principal, {
    query: "Fair",
    eventYear: 2027,
    cursor: first.nextCursor!,
  });
  expect(
    next.items
      .map((x) => x.id)
      .some((id) => first.items.some((x) => x.id === id)),
  ).toBe(false);
  expect(
    (
      await service.search(f.principal, {
        query: "",
        eventYear: null,
        limit: 1000,
      })
    ).items,
  ).toHaveLength(50);
  await f.db.query(
    "UPDATE organizations SET consolidated_into_id=$1 WHERE id=$2",
    [randomUUID(), f.profileId],
  );
  await expect(
    service.context(f.principal, { profileId: f.profileId, eventYear: 2027 }),
  ).rejects.toMatchObject({ code: "CONNECTION_PROFILE_UNAVAILABLE" });
});
it("caps huge mixed-year history and explicitly reports excerpts and omitted sections", async () => {
  await f.db.query(
    "INSERT INTO activities(organization_id,kind,body,occurred_at,timeline_sort_at) SELECT $1,'note',repeat('large evidence ',10000),'2020-01-01'::timestamptz+n*interval '1 year','2020-01-01'::timestamptz+n*interval '1 year' FROM generate_series(1,20) n",
    [f.profileId],
  );
  const result = await service.context(f.principal, {
    profileId: f.profileId,
    eventYear: 2027,
  });
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(24000);
  expect(result.sections.history.truncated).toBe(true);
  expect(result.omittedSections).toContain("contacts");
  expect(result.sections.history.items[0]).toMatchObject({
    eventYear: 2040,
    excerpt: true,
  });
  const next = await service.context(f.principal, {
    profileId: f.profileId,
    eventYear: 2027,
    section: "history",
    cursor: result.sections.history.nextCursor!,
  });
  expect(next.sections.history.items[0].id).not.toBe(
    result.sections.history.items[0].id,
  );
});
it("returns only saved extraction for the current accepted document version and linked profile", async () => {
  const doc = randomUUID(),
    version = randomUUID(),
    blob = randomUUID();
  await f.db.query(
    "INSERT INTO business_documents(id,display_name,current_version_id) VALUES($1,'Rules',$2)",
    [doc, version],
  );
  await f.db.query("INSERT INTO business_document_versions VALUES($1,$2,$3)", [
    version,
    doc,
    blob,
  ]);
  await f.db.query(
    "INSERT INTO business_document_blobs(id,sha256_hex) VALUES($1,'hash')",
    [blob],
  );
  await f.db.query(
    "INSERT INTO business_document_links(document_id,organization_id) VALUES($1,$2)",
    [doc, f.profileId],
  );
  await expect(
    service.documentText(f.principal, {
      profileId: f.profileId,
      documentId: doc,
    }),
  ).rejects.toMatchObject({ code: "CONNECTION_EXTRACTION_UNAVAILABLE" });
  await f.db.query(
    "INSERT INTO assistant_workspace_document_extractions VALUES('key','owner','completed',$1,now())",
    [
      JSON.stringify({
        evidence: [
          {
            kind: "document",
            recordId: doc,
            version: "hash",
            text: "Saved words",
            complete: true,
            eventYear: 2026,
          },
        ],
        data: { complete: true },
      }),
    ],
  );
  expect(
    (
      await service.documentText(f.principal, {
        profileId: f.profileId,
        documentId: doc,
      })
    ).items[0].text,
  ).toBe("Saved words");
  await f.db.query("UPDATE business_document_blobs SET sha256_hex='changed'");
  await expect(
    service.documentText(f.principal, {
      profileId: f.profileId,
      documentId: doc,
    }),
  ).rejects.toMatchObject({ code: "CONNECTION_EXTRACTION_UNAVAILABLE" });
  await f.db.query("DELETE FROM business_document_links");
  await expect(
    service.documentText(f.principal, {
      profileId: f.profileId,
      documentId: doc,
    }),
  ).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
});

it("reads dated facts with evidence, review status and stable pagination without crossing profiles", async () => {
  const { readFile } = await import("node:fs/promises");
  await f.db.exec(await readFile(new URL("../../../../../lib/db/migrations/20260921_event_date_coverage.sql", import.meta.url), "utf8"));
  await f.db.query("INSERT INTO event_date_facts(organization_id,starts_on,ends_on,status,active,rationale,source_kind,source_title,source_url) VALUES($1,'2027-05-01','2027-05-02','confirmed',true,'Published dates','web','Event website','https://event.example/dates')", [f.profileId]);
  await f.db.query("INSERT INTO event_date_facts(organization_id,starts_on,status,active,rationale,source_kind,source_title) SELECT $1,'2028-05-01','needs_review',false,'Conflicting date','derived','Review' FROM generate_series(1,11)", [f.profileId]);
  const other = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other')", [other]);
  await f.db.query("INSERT INTO event_date_facts(organization_id,starts_on,status,active,rationale,source_kind,source_title) VALUES($1,'2029-05-01','expected',true,'Annual pattern','derived','Other source')",[other]);
  const first = await service.context(f.principal,{profileId:f.profileId,eventYear:2027,section:"dates"});
  expect(first.sections.dates.items).toHaveLength(10);
  expect(first.sections.dates.truncated).toBe(true);
  const next = await service.context(f.principal,{profileId:f.profileId,eventYear:2027,section:"dates",cursor:first.sections.dates.nextCursor!});
  const items = [...first.sections.dates.items,...next.sections.dates.items];
  expect(items).toHaveLength(12);
  expect(new Set(items.map(x=>x.id)).size).toBe(12);
  expect(items).toEqual(expect.arrayContaining([expect.objectContaining({eventYear:2027,startsOn:"2027-05-01",endsOn:"2027-05-02",status:"confirmed",active:true,sourceUrl:"https://event.example/dates",text:"Published dates"})]));
  expect(items.filter(x=>x.status==="needs_review").every(x=>x.active===false)).toBe(true);
  expect(items.some(x=>x.subject==="Other source")).toBe(false);
  expect(next.sections.dates.nextCursor).toBeNull();
  expect(first.omittedSections).toContain("bookings");
  expect((await service.context(f.principal,{profileId:other,eventYear:2027,section:"dates"})).sections.dates.items[0]).toMatchObject({status:"expected",startsOn:"2029-05-01"});
});

it("returns booking end dates and advertises the separate date section", async () => {
 await f.db.query("INSERT INTO bookings(organization_id,name,starts_at,ends_at,status) VALUES($1,'Fair','2027-06-01T00:00:00Z','2027-06-03T00:00:00Z','potential')",[f.profileId]);
 const result=await service.context(f.principal,{profileId:f.profileId,eventYear:2027,section:"bookings"});
 expect(result.sections.bookings.items[0]).toMatchObject({occurredAt:"2027-06-01T00:00:00.000Z",endsAt:"2027-06-03T00:00:00.000Z",status:"potential"});
 expect(result.omittedSections).toContain("dates");
});
