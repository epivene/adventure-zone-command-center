import { describe, expect, it, vi } from "vitest";

import { OperationalCalendarProjectionRepository } from "./operational-calendar-projection-repository";

function firstQuery(result: unknown[]) {
  const query: any = {};
  query.from = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.limit = vi.fn(async () => result);
  return query;
}

function packageQuery(result: unknown[]) {
  const query: any = {};
  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.where = vi.fn(async () => result);
  return query;
}

describe("OperationalCalendarProjectionRepository booked state", () => {
  it("projects a definite Contract Received booking for David calendar sync", async () => {
    const actualStart = new Date("2026-09-05T00:00:00.000Z");
    const actualEnd = new Date("2026-09-07T00:00:00.000Z");
    const db = {
      select: vi.fn()
        .mockReturnValueOnce(firstQuery([{
          booking: {
            id: "meeteetse",
            status: "contract_received",
            probability: "definite",
            name: "Meeteetse Annual Labor Day Celebration 2026",
            city: "Meeteetse",
            region: "WY",
            postalCode: null,
            venueName: null,
            address1: null,
            notes: null,
            startsAt: actualStart,
            endsAt: actualEnd,
          },
          leg: { name: "Kristy" },
          contact: null,
          operationalStartsAt: null,
          operationalEndsAt: null,
          operationalSource: null,
        }]))
        .mockReturnValueOnce(packageQuery([{ code: "adventure_zone", name: "Adventure Zone" }])),
    };

    const result = await new OperationalCalendarProjectionRepository(db as any).loadConfirmedBooking("meeteetse");

    expect(result).toMatchObject({
      bookingId: "meeteetse",
      managerName: "Kristy",
      eventName: "Meeteetse Annual Labor Day Celebration 2026",
      packages: ["zone"],
      reservedStart: new Date("2026-09-03T00:00:00.000Z"),
      reservedEnd: new Date("2026-09-09T00:00:00.000Z"),
    });
  });
});
