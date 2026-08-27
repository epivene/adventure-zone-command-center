import { describe, expect, it, vi } from "vitest";

import { ScheduledEmailDispatcherLoop } from "./scheduled-email-dispatcher-loop";

describe("ScheduledEmailDispatcherLoop", () => {
  it("runs immediately and polls quickly after dispatch progress", async () => {
    const scheduled: Array<{ task: () => void; delay: number }> = [];
    const scheduler = {
      schedule: vi.fn((task: () => void, delay: number) => {
        scheduled.push({ task, delay });
        return scheduled.length;
      }),
      cancel: vi.fn(),
    };
    const dispatcher = { runOne: vi.fn().mockResolvedValue({ kind: "progress" as const, draftId: "draft-1" }) };
    const loop = new ScheduledEmailDispatcherLoop({
      dispatcher,
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-28T14:00:00.000Z") },
      scheduler,
    });

    loop.start();
    expect(scheduled[0]?.delay).toBe(0);
    scheduled[0]!.task();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dispatcher.runOne).toHaveBeenCalledTimes(1);
    expect(scheduled.at(-1)?.delay).toBe(1_000);
    await loop.close();
  });

  it("backs off while idle instead of busy-polling", async () => {
    const scheduled: Array<{ task: () => void; delay: number }> = [];
    const scheduler = {
      schedule: vi.fn((task: () => void, delay: number) => {
        scheduled.push({ task, delay });
        return scheduled.length;
      }),
      cancel: vi.fn(),
    };
    const dispatcher = { runOne: vi.fn().mockResolvedValue({ kind: "idle" as const }) };
    const loop = new ScheduledEmailDispatcherLoop({
      dispatcher,
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-28T14:00:00.000Z") },
      scheduler,
    });

    loop.start();
    scheduled[0]!.task();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scheduled.at(-1)?.delay).toBe(15_000);
    await loop.close();
  });

  it("cancels pending work on close", async () => {
    const scheduler = { schedule: vi.fn(() => 99), cancel: vi.fn() };
    const dispatcher = { runOne: vi.fn() };
    const loop = new ScheduledEmailDispatcherLoop({
      dispatcher,
      workerId: "worker-1",
      clock: { now: () => new Date() },
      scheduler,
    });

    loop.start();
    await loop.close();

    expect(scheduler.cancel).toHaveBeenCalledWith(99);
  });
});
