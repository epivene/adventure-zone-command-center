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
async function reminder() {
  return (
    await service.saveFollowup(
      f.principal,
      { requestKey: randomUUID() },
      {
        profileId: f.profileId,
        contactId: null,
        bookingId: null,
        kind: "email",
        dueAt: "2026-10-21T16:00:00Z",
      },
    )
  ).value;
}
it("dismisses obsolete work with a reason, retains history and replays its receipt", async () => {
  const original = await reminder();
  const input = {
    profileId: f.profileId,
    followupId: original.id,
    expectedRevision: original.revision,
    action: "dismiss" as const,
    reason: "Replaced by October 9 committee review",
  };
  const saved = await service.closeFollowup(
    f.principal,
    { requestKey: "dismiss" },
    input,
  );
  expect(saved.value.outcome).toBe(
    "Dismissed: Replaced by October 9 committee review",
  );
  expect(saved.value.completedAt).toBeTruthy();
  expect(saved.value.dueAt).toBe(original.dueAt);
  expect(saved.value.revision).not.toBe(original.revision);
  expect(
    await service.closeFollowup(f.principal, { requestKey: "dismiss" }, input),
  ).toEqual(saved);
  expect(
    (await service.listFollowups(f.principal, { profileId: f.profileId }))
      .items[0].outcome,
  ).toBe(saved.value.outcome);
  expect((await f.db.query("SELECT * FROM follow_ups")).rows).toHaveLength(1);
  await expect(
    service.closeFollowup(
      f.principal,
      { requestKey: "dismiss" },
      { ...input, reason: "Different" },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_REQUEST_CONFLICT" });
});
it("records actual completion without changing the reminder details or creating next work", async () => {
  const original = await reminder();
  const saved = await service.closeFollowup(
    f.principal,
    { requestKey: "complete" },
    {
      profileId: f.profileId,
      followupId: original.id,
      expectedRevision: original.revision,
      action: "complete",
      reason: "Customer called; dates discussed",
    },
  );
  expect(saved.value.outcome).toBe("Customer called; dates discussed");
  expect(saved.value.kind).toBe("email");
  const row = (
    await f.db.query("SELECT * FROM follow_ups WHERE id=$1", [original.id])
  ).rows[0];
  expect(row.next_follow_up_id).toBeNull();
  expect(row.completed_at).toBeTruthy();
});
it("rejects stale, cross-profile, malformed, unauthorized and revoked closure without receipts", async () => {
  const a = await reminder();
  const input = {
    profileId: f.profileId,
    followupId: a.id,
    expectedRevision: a.revision,
    action: "dismiss" as const,
    reason: "Obsolete",
  };
  const other = randomUUID();
  await f.db.query("INSERT INTO organizations(id,name) VALUES($1,'Other')", [
    other,
  ]);
  const count = async () =>
    Number(
      (await f.db.query("SELECT count(*) AS n FROM chatgpt_operations")).rows[0]
        .n,
    );
  const before = await count();
  await expect(
    service.closeFollowup(
      f.principal,
      { requestKey: "wrong" },
      { ...input, profileId: other },
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.closeFollowup(
      f.principal,
      { requestKey: "empty" },
      { ...input, reason: " " },
    ),
  ).rejects.toThrow();
  await expect(
    service.closeFollowup(
      { ...f.principal, scopes: ["crm:read"] },
      { requestKey: "scope" },
      input,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await f.db.query(
    "UPDATE follow_ups SET kind='phone',updated_at=updated_at+interval '1 second' WHERE id=$1",
    [a.id],
  );
  await expect(
    service.closeFollowup(f.principal, { requestKey: "stale" }, input),
  ).rejects.toMatchObject({ code: "CONNECTION_STALE_REVISION" });
  await f.db.query("UPDATE chatgpt_connections SET revoked_at=now()");
  await expect(
    service.closeFollowup(f.principal, { requestKey: "revoked" }, input),
  ).rejects.toMatchObject({ code: "CONNECTION_REVOKED" });
  expect(await count()).toBe(before);
  expect(
    (
      await f.db.query("SELECT completed_at FROM follow_ups WHERE id=$1", [
        a.id,
      ])
    ).rows[0].completed_at,
  ).toBeNull();
});
it("does not relabel an already closed reminder with a fresh key", async () => {
  const a = await reminder();
  const input = {
    profileId: f.profileId,
    followupId: a.id,
    expectedRevision: a.revision,
    action: "complete" as const,
    reason: "Called",
  };
  const closed = await service.closeFollowup(
    f.principal,
    { requestKey: "one" },
    input,
  );
  await expect(
    service.closeFollowup(
      f.principal,
      { requestKey: "two" },
      { ...input, expectedRevision: closed.value.revision, action: "dismiss" },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_FOLLOWUP_CLOSED" });
});
