import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../chatgpt-connection/test-database";
import { ensureBookingWorkSchema } from "../../db/booking-work-schema";
import { BookingWorkService } from "./service";
let f: Awaited<ReturnType<typeof fixture>>, s: BookingWorkService;
beforeEach(async () => {
  f = await fixture();
  await ensureBookingWorkSchema(f.db);
  s = new BookingWorkService(f.db);
});
afterEach(async () => {
  await f?.db.close();
});
const input = () => ({
  requestKey: "first",
  profileId: f.profileId,
  eventYear: 2027,
  queue: "replies" as const,
  title: "Reply",
  nextAction: "Review email",
});
it("returns committed receipt on identical retry but rejects changed payload", async () => {
  const a = await s.claim(f.principal, input());
  expect((await s.claim(f.principal, input())).operationId).toBe(a.operationId);
  await expect(
    s.claim(f.principal, { ...input(), title: "changed" }),
  ).rejects.toMatchObject({ code: "CONNECTION_REQUEST_CONFLICT" });
});
it("rejects missing scope and revoked connection", async () => {
  await expect(
    s.claim({ ...f.principal, scopes: ["crm:read"] }, input()),
  ).rejects.toMatchObject({ status: 403 });
  await f.db.query("UPDATE chatgpt_connections SET revoked_at=now()");
  await expect(s.claim(f.principal, input())).rejects.toMatchObject({
    code: "CONNECTION_REVOKED",
  });
});
it("protects owner edits, rejects wrong assignment, and keeps releases reserved", async () => {
  const a = (await s.claim(f.principal, input())).value.activity;
  const b = await s.ownerUpdate(a.id, 1, { nextAction: "My correction" });
  await expect(
    s.update(f.principal, {
      id: a.id,
      revision: 1,
      requestKey: "stale",
      patch: { nextAction: "lost" },
    }),
  ).rejects.toMatchObject({ code: "WORK_REVISION_CONFLICT" });
  const released = (
    await s.release(f.principal, {
      id: a.id,
      revision: b.revision,
      requestKey: "release",
    })
  ).value;
  expect(released.assignedTo).toBeNull();
  expect(released.nextAction).toBe("My correction");
  expect(
    (await s.claim(f.principal, { ...input(), requestKey: "another" })).value
      .created,
  ).toBe(false);
  const reclaimed = (
    await s.claimExisting(f.principal, {
      id: a.id,
      revision: released.revision,
      requestKey: "reclaim",
    })
  ).value;
  await s.reassign(a.id, reclaimed.revision, { kind: "owner", id: "owner" });
  await expect(
    s.update(f.principal, {
      id: a.id,
      revision: reclaimed.revision + 1,
      requestKey: "wrong",
      patch: { status: "completed" },
    }),
  ).rejects.toMatchObject({ code: "WORK_NOT_ASSIGNED" });
});
it("rejects foreign booking, invalid links, and rolls failed saves back", async () => {
  const other = randomUUID(),
    booking = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other')", [
    other,
  ]);
  await f.db.query(
    "INSERT INTO bookings(id,organization_id,starts_at) VALUES($1,$2,'2028-07-01')",
    [booking, other],
  );
  await expect(
    s.claim(f.principal, { ...input(), bookingId: booking }),
  ).rejects.toMatchObject({ code: "WORK_BOOKING_MISMATCH" });
  expect(
    (await f.db.query("SELECT * FROM chatgpt_operations")).rows,
  ).toHaveLength(0);
  const a = (await s.claim(f.principal, input())).value.activity;
  await expect(
    s.update(f.principal, {
      id: a.id,
      revision: 1,
      requestKey: "url",
      patch: {
        links: [{ kind: "email", label: "bad", url: "javascript:alert(1)" }],
      },
    }),
  ).rejects.toThrow();
  await expect(
    s.update(f.principal, {
      id: a.id,
      revision: 1,
      requestKey: "link",
      patch: {
        links: [{ kind: "followup", label: "wrong", recordId: randomUUID() }],
      },
    }),
  ).rejects.toMatchObject({ code: "WORK_LINK_MISMATCH" });
  expect(
    (await f.db.query("SELECT * FROM chatgpt_operations")).rows,
  ).toHaveLength(1);
});
it("does not reopen terminal work or accept foreign reassignment targets", async () => {
  const a = (await s.claim(f.principal, input())).value.activity;
  await expect(
    s.reassign(a.id, 1, { kind: "connection", id: randomUUID() }),
  ).rejects.toMatchObject({ code: "WORK_INVALID_ACTOR" });
  await s.ownerUpdate(a.id, 1, { status: "completed" });
  await expect(
    s.ownerUpdate(a.id, 2, { status: "queued" }),
  ).rejects.toMatchObject({ code: "WORK_CLOSED" });
});
it("rejects wrong-year drafts and booking-linked follow-ups on the same profile", async () => {
  const a = (await s.claim(f.principal, input())).value.activity;
  const draft = randomUUID(),
    booking = randomUUID(),
    followup = randomUUID();
  await f.db.query(
    "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision) VALUES($1,'owner',$2,$3,gen_random_uuid())",
    [
      draft,
      f.principal.connectionId,
      JSON.stringify({ organizationId: f.profileId, eventYear: 2028 }),
    ],
  );
  await f.db.query(
    "INSERT INTO bookings(id,organization_id,starts_at) VALUES($1,$2,'2028-07-01')",
    [booking, f.profileId],
  );
  await f.db.query(
    "INSERT INTO follow_ups(id,organization_id,booking_id) VALUES($1,$2,$3)",
    [followup, f.profileId, booking],
  );
  for (const link of [
    { kind: "draft" as const, recordId: draft, label: "Draft" },
    { kind: "followup" as const, recordId: followup, label: "Follow-up" },
  ]) {
    await expect(
      s.ownerUpdate(a.id, 1, { links: [link] }),
    ).rejects.toMatchObject({ code: "WORK_LINK_MISMATCH" });
  }
  await f.db.query(
    "UPDATE chatgpt_external_drafts SET content=jsonb_set(content,'{eventYear}','2027') WHERE id=$1",
    [draft],
  );
  expect(
    (
      await s.ownerUpdate(a.id, 1, {
        links: [{ kind: "draft", recordId: draft, label: "Correct year" }],
      })
    ).links,
  ).toHaveLength(1);
});
