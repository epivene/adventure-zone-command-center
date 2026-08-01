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

  it("pages revision bodies in bounded batches", async () => {
    const revisions = Array.from({ length: 26 }, (_, index) => ({
      id: `revision-${index}`,
      activityId: "11111111-1111-4111-8111-111111111111",
      priorBody: `Before ${index}`,
      replacementBody: `After ${index}`,
      reason: "Correction",
      createdAt: new Date(`2026-07-${String(28 - index).padStart(2, "0")}T15:00:00Z`),
    }));
    const offset = vi.fn(async () => revisions);
    const limitResult = { offset };
    const limit = vi.fn(() => limitResult);
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue({ limit });
    const database = { select: vi.fn(() => chain) };

    await expect(
      new DrizzleActivityRepository(database as never).listRevisions(
        "11111111-1111-4111-8111-111111111111",
        2,
      ),
    ).resolves.toMatchObject({
      revisions: expect.any(Array),
      nextPage: 3,
    });
    expect(limit).toHaveBeenCalledWith(26);
    expect(offset).toHaveBeenCalledWith(25);
  });
});
