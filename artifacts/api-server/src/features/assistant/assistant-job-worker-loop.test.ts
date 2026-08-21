import { describe, expect, it, vi } from "vitest";

import { AssistantJobWorkerLoop } from "./assistant-job-worker-loop";

describe("AssistantJobWorkerLoop", () => {
  it("runs work immediately and schedules another short tick after progress", async () => {
    const scheduled: Array<{ task: () => void; delay: number }> = [];
    const scheduler = {
      schedule: vi.fn((task: () => void, delay: number) => {
        scheduled.push({ task, delay });
        return scheduled.length;
      }),
      cancel: vi.fn(),
    };
    const worker = { runOne: vi.fn().mockResolvedValue({ kind: "worked" as const }) };
    const loop = new AssistantJobWorkerLoop({
      worker,
      workerId: "worker-1",
      clock: { now: () => new Date("2026-08-21T16:00:00Z") },
      scheduler,
    });

    loop.start();
    expect(scheduled[0]?.delay).toBe(0);
    scheduled[0]!.task();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worker.runOne).toHaveBeenCalledTimes(1);
    expect(scheduled.at(-1)?.delay).toBe(1_000);
    await loop.close();
  });
});
