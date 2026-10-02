import { expect, it, vi } from "vitest";
import { createPlanningClient } from "./planning-client";
import { planningFixture, planningIds } from "@/test/leg-planning-fixture";
it("reuses a lost-response request key for the same mutation intent", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({
      receiptId: "receipt",
      value: {},
      affectedBookingIds: [],
      idempotent: true,
    });
  const c = createPlanningClient(request, "owner");
  await expect(
    c.write("/leg-splits", {
      payload: { bookingIds: [planningIds.booking, planningIds.other] },
      expectedRevision: null,
      requestKey: "first",
    }),
  ).rejects.toThrow("Response lost");
  await c.write("/leg-splits", {
    payload: { bookingIds: [planningIds.booking, planningIds.other] },
    expectedRevision: null,
    requestKey: "second",
  });
  expect(JSON.parse(request.mock.calls[1][1].body).requestKey).toBe("first");
});
it.each(["owner", "boss", "manager"] as const)(
  "uses existing %s authentication path and validates server capability",
  async (role) => {
    const request = vi.fn(async (_path: string) => planningFixture());
    const c = createPlanningClient(request as never, role);
    await c.read(planningIds.booking);
    expect(request.mock.calls[0][0]).toBe(
      `${role === "owner" ? "" : `/${role}`}/bookings/${planningIds.booking}/operating-plan`,
    );
    request.mockResolvedValue({
      ...planningFixture(),
      catalog: { enabled: false },
    } as never);
    await expect(c.read(planningIds.booking)).rejects.toThrow();
  },
);
