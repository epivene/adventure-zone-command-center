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
