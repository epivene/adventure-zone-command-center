import { describe, expect, it, vi } from "vitest";

import { DrizzleActivityRepository } from "@/features/activities/activity-repository";

describe("DrizzleActivityRepository.listTimeline", () => {
  it("limits the contextual activity query to ten rows while retaining revision counts", async () => {
    const records = [{
      activity: {
        id: "activity-1",
        organizationId: "11111111-1111-4111-8111-111111111111",
        contactId: "22222222-2222-4222-8222-222222222222",
        bookingId: null,
        kind: "call" as const,
        body: "Recorded call.",
        occurredAt: new Date("2026-07-28T15:00:00Z"),
        createdAt: new Date("2026-07-28T15:00:00Z"),
        updatedAt: new Date("2026-07-28T15:00:00Z"),
      },
      revisionCount: 2,
    }];
    const limit = vi.fn(async () => records);
    const result = {
      limit,
      then: <T,>(resolve: (value: typeof records) => T) => Promise.resolve(records).then(resolve),
    };
    const chain = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      groupBy: vi.fn(),
      orderBy: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.groupBy.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(result);
    const database = { select: vi.fn(() => chain) };

    await expect(new DrizzleActivityRepository(database as never).listTimeline({
      contactId: "22222222-2222-4222-8222-222222222222",
    })).resolves.toMatchObject([{ id: "activity-1", revisionCount: 2 }]);
    expect(limit).toHaveBeenCalledWith(10);
  });
});
