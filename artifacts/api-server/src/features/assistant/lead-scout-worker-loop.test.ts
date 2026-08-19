import { describe, expect, it, vi } from "vitest";

import { LeadScoutWorkerLoop, type LeadScoutWorkerLoopScheduler } from "./lead-scout-worker-loop";

function harness(results: Array<"idle" | "progress">) {
  const scheduled: Array<{ task: () => void; delayMs: number; handle: object }> = [];
  const cancelled: object[] = [];
  const scheduler: LeadScoutWorkerLoopScheduler = {
    schedule(task, delayMs) {
      const handle = {};
      scheduled.push({ task, delayMs, handle });
      return handle;
    },
    cancel(handle) { cancelled.push(handle as object); },
  };
  const worker = {
    runOne: vi.fn(async (): Promise<{ kind: "idle" | "progress" }> => {
      const kind: "idle" | "progress" = results.shift() ?? "idle";
      return { kind };
    }),
  };
  const loop = new LeadScoutWorkerLoop({
    worker,
    workerId: "worker-a",
    clock: { now: () => new Date("2026-08-19T18:00:00Z") },
    scheduler,
  });
  return { loop, worker, scheduled, cancelled };
}

describe("LeadScoutWorkerLoop", () => {
  it("schedules an immediate first tick and a 2 second idle retry", async () => {
    const h = harness(["idle"]);
    h.loop.start();
    expect(h.scheduled[0]?.delayMs).toBe(0);
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.worker.runOne).toHaveBeenCalledTimes(1);
    expect(h.scheduled[0]?.delayMs).toBe(2000);
    await h.loop.close();
  });

  it("uses a zero-delay retry after progress", async () => {
    const h = harness(["progress"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.scheduled[0]?.delayMs).toBe(0);
    await h.loop.close();
  });

  it("cancels pending work on close", async () => {
    const h = harness([]);
    h.loop.start();
    const pending = h.scheduled[0]?.handle;
    await h.loop.close();
    expect(h.cancelled).toContain(pending);
  });
});
