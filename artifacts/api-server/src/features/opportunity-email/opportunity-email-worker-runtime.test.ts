import { describe, expect, it, vi } from "vitest";

import { createOpportunityEmailWorkerLoop } from "./opportunity-email-worker-runtime";

function scheduler() {
  let task: (() => void) | null = null;
  return {
    schedule: vi.fn((next: () => void, _delayMs: number) => {
      task = next;
      return { id: 1 };
    }),
    cancel: vi.fn(),
    run() {
      const next = task;
      task = null;
      next?.();
    },
  };
}

describe("createOpportunityEmailWorkerLoop", () => {
  it("uses the shared production runtime dispatcher and closes cleanly", async () => {
    const runOne = vi.fn(async () => ({ kind: "idle" as const }));
    const loadRuntime = vi.fn(async () => ({ dispatcher: { runOne } }));
    const clock = { now: vi.fn(() => new Date("2026-08-28T15:00:00.000Z")) };
    const timers = scheduler();

    const loop = await createOpportunityEmailWorkerLoop(loadRuntime as any, {
      workerId: "opportunity-email-worker-1",
      clock,
      scheduler: timers,
    });
    loop.start();
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(timers.schedule).toHaveBeenCalledWith(expect.any(Function), 0);

    timers.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(runOne).toHaveBeenCalledWith({
      workerId: "opportunity-email-worker-1",
      now: new Date("2026-08-28T15:00:00.000Z"),
    });

    await loop.close();
  });
});
