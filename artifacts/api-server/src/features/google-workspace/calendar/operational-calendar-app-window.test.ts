import { describe, expect, it, vi } from "vitest";

import { OperationalCalendarProjectionRepository } from "./operational-calendar-projection-repository";

function bookingWindowQuery(result: unknown[]) {
  const query: any = {};
  query.from = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.limit = vi.fn(async () => result);
  return query;
}

describe("OperationalCalendarProjectionRepository app window", () => {
  it("persists the default app window without requiring a leg or package", async () => {
    const startsAt = new Date("2026-09-05T00:00:00.000Z");
    const endsAt = new Date("2026-09-07T00:00:00.000Z");
    const db = {
      select: vi.fn().mockReturnValueOnce(bookingWindowQuery([{
        status: "contract_received",
        probability: "definite",
        startsAt,
        endsAt,
        operationalSource: null,
      }])),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };

    await new OperationalCalendarProjectionRepository(db as any).ensureAppOperationalWindow("meeteetse");

    expect(db.insert).toHaveBeenCalled();
    expect(db.insert.mock.results[0]?.value.values).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: "meeteetse",
      startsAt: new Date("2026-09-03T00:00:00.000Z"),
      endsAt: new Date("2026-09-09T00:00:00.000Z"),
      source: "app",
    }));
  });

  it("does not overwrite a Google or manual operational window", async () => {
    const db = {
      select: vi.fn().mockReturnValueOnce(bookingWindowQuery([{
        status: "confirmed",
        probability: "definite",
        startsAt: new Date("2026-09-05T00:00:00.000Z"),
        endsAt: new Date("2026-09-07T00:00:00.000Z"),
        operationalSource: "google_calendar",
      }])),
      insert: vi.fn(),
    };

    await new OperationalCalendarProjectionRepository(db as any).ensureAppOperationalWindow("imported");

    expect(db.insert).not.toHaveBeenCalled();
  });
});