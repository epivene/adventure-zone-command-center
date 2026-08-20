import { describe, expect, it, vi } from "vitest";

import { PaperNoteWorkerLoop, type PaperNoteWorkerLoopScheduler } from "./paper-note-worker-loop";

function harness(results: Array<"idle" | "processed" | "error">) {
  const scheduled: Array<{ task: () => void; delayMs: number; handle: object }> = [];
  const cancelled: object[] = [];
  const scheduler: PaperNoteWorkerLoopScheduler = {
    schedule(task, delayMs) {
      const handle = {};
      scheduled.push({ task, delayMs, handle });
      return handle;
    },
    cancel(handle) { cancelled.push(handle as object); },
  };
  const worker = {
    runOne: vi.fn(async (): Promise<{ kind: "idle" | "processed" }> => {
      const kind = results.shift() ?? "idle";
      if (kind === "error") throw Object.assign(new Error("db unavailable"), { code: "ETIMEDOUT" });
      return { kind };
    }),
  };
  const loop = new PaperNoteWorkerLoop({
    worker,
    workerId: "paper-worker-a",
    clock: { now: () => new Date("2026-08-20T20:00:00Z") },
    scheduler,
  });
  return { loop, worker, scheduled, cancelled };
}

describe("PaperNoteWorkerLoop", () => {
  it("starts once and waits 30 seconds after an idle check", async () => {
    const h = harness(["idle"]);
    h.loop.start();
    h.loop.start();
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]?.delayMs).toBe(0);
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.worker.runOne).toHaveBeenCalledTimes(1);
    expect(h.scheduled[0]?.delayMs).toBe(30_000);
    await h.loop.close();
  });

  it("uses a one-second delay after processing a page", async () => {
    const h = harness(["processed"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.scheduled[0]?.delayMs).toBe(1_000);
    await h.loop.close();
  });

  it("backs off for 60 seconds after an unexpected outer failure", async () => {
    const h = harness(["error"]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.scheduled[0]?.delayMs).toBe(60_000);
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
