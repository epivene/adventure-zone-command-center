import { describe, expect, it, vi } from "vitest";
import { EarlyBirdPromoWorkerLoop } from "./early-bird-promo-worker-loop";

describe("EarlyBirdPromoWorkerLoop", () => {
  it("polls quickly after progress and backs off while idle", async () => {
    const scheduled: Array<{ task: () => void; delay: number }> = [];
    const scheduler = {
      schedule: vi.fn((task: () => void, delay: number) => {
        scheduled.push({ task, delay });
        return scheduled.length;
      }),
      cancel: vi.fn(),
    };
    const worker = {
      runOne: vi.fn()
        .mockResolvedValueOnce({ kind: "progress", enrollmentId: "promo-1" })
        .mockResolvedValueOnce({ kind: "idle" }),
    };
    const loop = new EarlyBirdPromoWorkerLoop({
      worker: worker as any,
      workerId: "worker-1",
      clock: { now: () => new Date("2026-09-25T05:00:00Z") },
      scheduler,
    });

    loop.start();
    expect(scheduled[0]?.delay).toBe(0);
    scheduled[0]!.task();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduled.at(-1)?.delay).toBe(1_000);

    scheduled.at(-1)!.task();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduled.at(-1)?.delay).toBe(15_000);
    await loop.close();
  });
});
