import { beforeEach, afterEach, it, expect } from "vitest";
import { fixture } from "../chatgpt-connection/test-database";
import { ensureBookingWorkSchema } from "../../db/booking-work-schema";
import { BookingWorkRepository } from "./repository";
import { createWorkSchema, patchWorkSchema } from "./contracts";
let f: Awaited<ReturnType<typeof fixture>>, repo: BookingWorkRepository;
const actor = { kind: "owner" as const, id: "owner" };
beforeEach(async () => {
  f = await fixture();
  await ensureBookingWorkSchema(f.db);
  repo = new BookingWorkRepository(f.db);
});
afterEach(async () => {
  await f?.db.close();
});
const input = () => ({
  profileId: f.profileId,
  eventYear: 2027,
  queue: "replies" as const,
  title: "Reply to fair",
  nextAction: "Read history",
});
it("concurrent claims return a single activity and preserve the first owner", async () => {
  const results = await Promise.all([
    repo.createOrGet(input(), actor),
    repo.createOrGet(input(), { kind: "connection", id: "other" }),
  ]);
  expect(new Set(results.map((x) => x.activity.id)).size).toBe(1);
  expect(results.filter((x) => x.created)).toHaveLength(1);
  expect(results[1].activity.assignedTo).toEqual(actor);
});
it("separates years and preserves closed work when creating new activity", async () => {
  const first = await repo.createOrGet(input(), actor);
  const other = await repo.createOrGet({ ...input(), eventYear: 2028 }, actor);
  expect(other.activity.id).not.toBe(first.activity.id);
  await repo.patch(first.activity.id, 1, { status: "completed" }, actor);
  expect((await repo.createOrGet(input(), actor)).created).toBe(true);
  expect((await repo.read(first.activity.id))?.status).toBe("completed");
});
it("rejects stale changes and keeps released work reserved", async () => {
  const { activity: a } = await repo.createOrGet(input(), actor);
  await repo.patch(a.id, 1, { nextAction: "Owner edits" }, null);
  await expect(
    repo.patch(a.id, 1, { nextAction: "Stale" }, actor),
  ).rejects.toMatchObject({ code: "WORK_REVISION_CONFLICT" });
  expect((await repo.read(a.id))?.nextAction).toBe("Owner edits");
  expect((await repo.createOrGet(input(), actor)).created).toBe(false);
});
it("paginates deterministically and rejects invalid or changed-filter cursors", async () => {
  for (const year of [2027, 2028, 2029])
    await repo.createOrGet({ ...input(), eventYear: year }, actor);
  const one = await repo.list({ limit: 2 });
  const two = await repo.list({ limit: 2, cursor: one.nextCursor! });
  expect(new Set([...one.items, ...two.items].map((x) => x.id)).size).toBe(3);
  expect(two.nextCursor).toBeNull();
  await expect(repo.list({ cursor: "garbage" })).rejects.toThrow();
  await expect(
    repo.list({ cursor: one.nextCursor!, eventYear: 2027 }),
  ).rejects.toThrow();
});
it("validates progress, years and strict fields", () => {
  expect(
    createWorkSchema.safeParse({ ...input(), eventYear: 1999 }).success,
  ).toBe(false);
  expect(
    patchWorkSchema.safeParse({
      progress: { completed: 3, total: 2, summary: "invalid" },
    }).success,
  ).toBe(false);
  expect(patchWorkSchema.safeParse({ send: true }).success).toBe(false);
});
