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
