import { describe, expect, it, vi } from "vitest";

import { LeadScoutWorkerLoop, type LeadScoutWorkerLoopScheduler } from "./lead-scout-worker-loop";

function harness(results: Array<"idle" | "progress" | "error">) {
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
      const kind = results.shift() ?? "idle";
      if (kind === "error") throw Object.assign(new Error("db unavailable"), { code: "ETIMEDOUT" });
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
  it("schedules an immediate first tick and a 30 second idle retry", async () => {
    const h = harness(["idle"]);
    h.loop.start();
    expect(h.scheduled[0]?.delayMs).toBe(0);
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.worker.runOne).toHaveBeenCalledTimes(1);
    expect(h.scheduled[0]?.delayMs).toBe(30_000);
    await h.loop.close();
  });

  it("backs off for 60 seconds after a worker failure", async () => {
    const h = harness(["error"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.scheduled[0]?.delayMs).toBe(60_000);
    await h.loop.close();
  });

  it("uses a short delay after progress instead of a zero-delay hot loop", async () => {
    const h = harness(["progress"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.scheduled[0]?.delayMs).toBe(1_000);
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
