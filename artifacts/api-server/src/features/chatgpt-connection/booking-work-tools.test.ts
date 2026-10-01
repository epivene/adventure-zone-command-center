import { beforeEach, afterEach, it, expect } from "vitest";
import { fixture } from "./test-database";
import { ensureBookingWorkSchema } from "../../db/booking-work-schema";
import { BookingWorkService } from "../booking-work/service";
import { bookingWorkTools } from "./booking-work-tools";
let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
  await ensureBookingWorkSchema(f.db);
});
afterEach(async () => {
  await f?.db.close();
});
it("claims and updates through strict connector tools, with paginated reads", async () => {
  const ts = bookingWorkTools(new BookingWorkService(f.db), f.principal);
  const call = async (name: string, input: any) => {
    const t = ts.find((t) => t.name === name)!;
    return t.call(t.schema.parse(input)) as any;
  };
  const r = await call("claim_booking_work", {
    requestKey: "claim",
    profileId: f.profileId,
    eventYear: 2027,
    queue: "replies",
    title: "Reply",
    nextAction: "Read email",
  });
  const a = r.value.activity;
  await call("update_booking_work", {
    requestKey: "update",
    id: a.id,
    revision: 1,
    patch: { status: "draft_ready", nextAction: "Review draft" },
  });
  expect((await call("read_booking_work", { id: a.id })).status).toBe(
    "draft_ready",
  );
  expect(
    (await call("list_booking_work", { eventYear: 2027, limit: 1 })).items,
  ).toHaveLength(1);
  await expect(call("claim_booking_work", { send: true })).rejects.toThrow();
});
it("enforces actual read and mutation scopes when invoked directly", async () => {
  const tools = bookingWorkTools(new BookingWorkService(f.db), {
    ...f.principal,
    scopes: ["crm:read"],
  });
  await expect(
    tools
      .find((t) => t.name === "claim_booking_work")!
      .call({
        requestKey: "no",
        profileId: f.profileId,
        eventYear: 2027,
        queue: "replies",
        title: "Reply",
        nextAction: "Read",
      }),
  ).rejects.toMatchObject({ status: 403 });
});
