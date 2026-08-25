import { describe, expect, it, vi } from "vitest";

import {
  ScoutAlertWorkerLoop,
  type ScoutAlertWorkerLoopScheduler,
} from "./scout-alert-worker-loop";

function harness(results: Array<"idle" | "progress" | "error">) {
  const scheduled: Array<{ task: () => void; delayMs: number; handle: object }> = [];
  const cancelled: object[] = [];
  const scheduler: ScoutAlertWorkerLoopScheduler = {
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
      if (kind === "error") throw Object.assign(new Error("database unavailable"), { code: "ETIMEDOUT" });
      return { kind };
    }),
  };
  const loop = new ScoutAlertWorkerLoop({
    worker,
    workerId: "scout-alert-worker-a",
    clock: { now: () => new Date("2026-08-25T12:00:00.000Z") },
    scheduler,
  });
  return { loop, worker, scheduled, cancelled };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ScoutAlertWorkerLoop", () => {
  it("starts only once and schedules an immediate first tick", () => {
    const h = harness([]);
    h.loop.start();
    h.loop.start();
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.delayMs).toBe(0);
  });

  it("waits 30 seconds after an idle step", async () => {
    const h = harness(["idle"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await flush();
    expect(h.worker.runOne).toHaveBeenCalledWith({
      workerId: "scout-alert-worker-a",
      now: new Date("2026-08-25T12:00:00.000Z"),
    });
    expect(h.scheduled[0]?.delayMs).toBe(30_000);
    await h.loop.close();
  });

  it("uses a one-second delay after progress", async () => {
    const h = harness(["progress"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await flush();
    expect(h.scheduled[0]?.delayMs).toBe(1_000);
    await h.loop.close();
  });

  it("backs off for 60 seconds after an unexpected worker error", async () => {
    const h = harness(["error"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await flush();
    expect(h.scheduled[0]?.delayMs).toBe(60_000);
    await h.loop.close();
  });

  it("cancels pending work on close and never schedules again", async () => {
    const h = harness([]);
    h.loop.start();
    const pending = h.scheduled[0]?.handle;
    await h.loop.close();
    expect(h.cancelled).toContain(pending);
    expect(h.scheduled).toHaveLength(1);
  });

  it("waits for an active worker call to finish during close", async () => {
    let finish!: (value: { kind: "idle" }) => void;
    const active = new Promise<{ kind: "idle" }>((resolve) => { finish = resolve; });
    const scheduled: Array<{ task: () => void; delayMs: number; handle: object }> = [];
    const scheduler: ScoutAlertWorkerLoopScheduler = {
      schedule(task, delayMs) {
        const handle = {};
        scheduled.push({ task, delayMs, handle });
        return handle;
      },
      cancel() {},
    };
    const worker = { runOne: vi.fn(() => active) };
    const loop = new ScoutAlertWorkerLoop({
      worker,
      workerId: "worker-a",
      clock: { now: () => new Date("2026-08-25T12:00:00.000Z") },
      scheduler,
    });
    loop.start();
    scheduled.shift()?.task();
    await Promise.resolve();

    let closed = false;
    const closing = loop.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish({ kind: "idle" });
    await closing;
    expect(closed).toBe(true);
    expect(scheduled).toHaveLength(0);
  });
});
