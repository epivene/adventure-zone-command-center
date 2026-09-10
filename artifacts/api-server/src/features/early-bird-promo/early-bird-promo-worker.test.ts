import { describe, expect, it, vi } from "vitest";
import { EarlyBirdPromoWorker } from "./early-bird-promo-worker";

describe("EarlyBirdPromoWorker", () => {
  it("expires old offers before preparing exactly one review reminder", async () => {
    const now = new Date("2026-09-25T05:00:00Z");
    const enrollment = { id: "promo-1", deadlineDate: "2026-10-10" };
    const repository = {
      expireDue: vi.fn(async () => 0),
      claimOneReminder: vi.fn(async () => enrollment),
      createReminderArtifacts: vi.fn(async () => ({
        draftId: "draft-1",
        followUpId: "follow-up-1",
      })),
      releaseReminderClaim: vi.fn(async () => undefined),
    };
    const worker = new EarlyBirdPromoWorker(repository as any);

    await expect(worker.runOne({ workerId: "worker-1", now })).resolves.toEqual({
      kind: "progress",
      enrollmentId: "promo-1",
    });
    expect(repository.expireDue).toHaveBeenCalledWith(now);
    expect(repository.claimOneReminder).toHaveBeenCalledWith({ workerId: "worker-1", now });
    expect(repository.createReminderArtifacts).toHaveBeenCalledWith({
      enrollmentId: "promo-1",
      workerId: "worker-1",
      now,
    });
  });

  it("releases the claim when reminder preparation fails", async () => {
    const now = new Date("2026-09-25T05:00:00Z");
    const repository = {
      expireDue: vi.fn(async () => 0),
      claimOneReminder: vi.fn(async () => ({ id: "promo-1" })),
      createReminderArtifacts: vi.fn(async () => { throw new Error("draft failed"); }),
      releaseReminderClaim: vi.fn(async () => undefined),
    };
    const worker = new EarlyBirdPromoWorker(repository as any);

    await expect(worker.runOne({ workerId: "worker-1", now })).rejects.toThrow("draft failed");
    expect(repository.releaseReminderClaim).toHaveBeenCalledWith({
      enrollmentId: "promo-1",
      workerId: "worker-1",
      now,
    });
  });
});
