import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { DraftFollowupService } from "./draft-followup-service";
let f: Awaited<ReturnType<typeof fixture>>, service: DraftFollowupService;
beforeEach(async () => {
  f = await fixture();
  service = new DraftFollowupService(f.db);
});
afterEach(async () => f.db.close());
function content() {
  return {
    to: ["office@fair.example"],
    cc: [],
    subject: "Event question",
    html: "<p>Hello</p><script>alert(1)</script>",
    text: "Hello",
    threadId: null,
    attachmentIds: [],
    attachmentHashes: [],
    organizationId: f.profileId,
    templateId: null,
    templateVersion: null,
    contactId: null,
    bookingId: null,
    eventYear: 2027,
  };
}
it("sanitizes drafts, saves once, checks revision and stays available with AI disabled", async () => {
  process.env.ASSISTANT_WORKSPACE_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
  const input = { content: content() };
  const saved = await service.saveDraft(
    f.principal,
    { requestKey: "draft" },
    input,
  );
  expect(
    await service.saveDraft(f.principal, { requestKey: "draft" }, input),
  ).toEqual(saved);
  const rows = await service.ownerDrafts("owner");
  expect(rows).toHaveLength(1);
  expect(rows[0].content.html).not.toContain("<script");
  expect(rows[0].content.text).toBe("Hello");
  await expect(
    service.saveDraft(
      f.principal,
      { requestKey: "stale" },
      {
        draftId: saved.recordId,
        expectedRevision: randomUUID(),
        content: content(),
      },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
});
it("rejects contacts, bookings and attachments not linked to the profile", async () => {
  for (const patch of [
    { contactId: randomUUID() },
    { bookingId: randomUUID() },
    { attachmentIds: [randomUUID()], attachmentHashes: ["hash"] },
    { threadId: "unlinked-thread" },
  ])
    await expect(
      service.saveDraft(
        f.principal,
        { requestKey: JSON.stringify(patch) },
        { content: { ...content(), ...patch } },
      ),
    ).rejects.toThrow();
});
it("requires an explicit due date and preserves the existing single-active booking rule", async () => {
  const bookingId = randomUUID();
  await f.db.query(
    "INSERT INTO bookings(id,organization_id,name,status) VALUES($1,$2,'Fair 2027','new_lead')",
    [bookingId, f.profileId],
  );
  const input = {
    profileId: f.profileId,
    contactId: null,
    bookingId,
    kind: "call",
    dueAt: "2026-10-05T15:00:00-06:00",
  };
  await expect(
    service.saveFollowup(
      f.principal,
      { requestKey: "missing" },
      { ...input, dueAt: "" },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_DUE_DATE_REQUIRED" });
  const first = await service.saveFollowup(
    f.principal,
    { requestKey: "first" },
    input,
  );
  expect(
    await service.saveFollowup(f.principal, { requestKey: "first" }, input),
  ).toEqual(first);
  await service.saveFollowup(
    f.principal,
    { requestKey: "second" },
    { ...input, dueAt: "2026-10-06T15:00:00-06:00" },
  );
  expect(
    (await f.db.query("SELECT * FROM follow_ups WHERE completed_at IS NULL"))
      .rows,
  ).toHaveLength(1);
  expect((await f.db.query("SELECT * FROM follow_ups")).rows).toHaveLength(2);
  const page = await service.listFollowups(f.principal, {
    profileId: f.profileId,
  });
  expect(page.items).toHaveLength(2);
});
it("reopens a sanitized draft and revises the same record", async () => {
  const saved = await service.saveDraft(f.principal, { requestKey: "read-save" }, { content: content() });
  const page = await service.listDrafts(f.principal, { profileId: f.profileId });
  expect(page.items.map((d: any) => d.id)).toEqual([saved.recordId]);
  const draft = await service.readDraft(f.principal, { profileId: f.profileId, draftId: saved.recordId });
  expect(draft.content.html).not.toContain("<script");
  expect(draft.revision).toBe(saved.revision);
  await service.saveDraft(f.principal, { requestKey: "read-update" }, {
    draftId: draft.id, expectedRevision: draft.revision,
    content: { ...draft.content, subject: "Updated question" },
  });
  const updated = await service.readDraft(f.principal, { profileId: f.profileId, draftId: draft.id });
  expect(updated.content.subject).toBe("Updated question");
  expect(updated.revision).not.toBe(draft.revision);
  expect(await service.ownerDrafts("owner")).toHaveLength(1);
});
it("paginates tied timestamps and validates cursor bindings", async () => {
  await f.db.query(
    "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision,updated_at) SELECT gen_random_uuid(),'owner',$1,$2,gen_random_uuid(),'2026-10-01' FROM generate_series(1,23)",
    [f.principal.connectionId, JSON.stringify(content())],
  );
  const first = await service.listDrafts(f.principal, { profileId: f.profileId });
  expect(first.items).toHaveLength(20);
  const second = await service.listDrafts(f.principal, { profileId: f.profileId, cursor: first.nextCursor! });
  expect(second.items).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map((d: any) => d.id)).size).toBe(23);
  expect(second.nextCursor).toBeNull();
  await expect(service.listDrafts(f.principal, { profileId: f.profileId, cursor: "bad" })).rejects.toMatchObject({ code: "CONNECTION_INVALID_CURSOR" });
  for (const patch of [{ connectionId: randomUUID() }, { profileId: randomUUID() }]) {
    const decoded = { ...JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString()), ...patch };
    await expect(service.listDrafts(f.principal, { profileId: f.profileId, cursor: Buffer.from(JSON.stringify(decoded)).toString("base64url") })).rejects.toMatchObject({ code: "CONNECTION_INVALID_CURSOR" });
  }
});
it("isolates drafts by owner, connection and profile and rejects revoked reads", async () => {
  const saved = await service.saveDraft(f.principal, { requestKey: "private" }, { content: content() });
  const otherConnection = randomUUID();
  await f.db.query("INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,'owner','other','[]')", [otherConnection]);
  for (const [owner, connection, profile] of [
    ["other", f.principal.connectionId, f.profileId],
    ["owner", otherConnection, f.profileId],
    ["owner", f.principal.connectionId, randomUUID()],
  ]) {
    await f.db.query("UPDATE chatgpt_external_drafts SET owner_id=$2,connection_id=$3,content=$4 WHERE id=$1", [saved.recordId, owner, connection, JSON.stringify({ ...content(), organizationId: profile })]);
    expect((await service.listDrafts(f.principal, { profileId: f.profileId })).items).toEqual([]);
    await expect(service.readDraft(f.principal, { profileId: f.profileId, draftId: saved.recordId })).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
  }
  await expect(service.listDrafts({ ...f.principal, scopes: [] }, { profileId: f.profileId })).rejects.toThrow();
  await expect(service.readDraft({ ...f.principal, scopes: [] }, { profileId: f.profileId, draftId: saved.recordId })).rejects.toThrow();
  await f.db.query("UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1", [f.principal.connectionId]);
  await expect(service.listDrafts(f.principal, { profileId: f.profileId })).rejects.toMatchObject({ code: "CONNECTION_REVOKED" });
  await expect(service.readDraft(f.principal, { profileId: f.profileId, draftId: saved.recordId })).rejects.toMatchObject({ code: "CONNECTION_REVOKED" });
});
