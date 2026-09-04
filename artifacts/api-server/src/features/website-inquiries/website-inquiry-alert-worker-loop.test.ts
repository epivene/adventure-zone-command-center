import { describe, expect, it, vi } from "vitest";

import {
  WebsiteInquiryAlertWorkerLoop,
  type WebsiteInquiryAlertWorkerLoopScheduler,
} from "./website-inquiry-alert-worker-loop";

function harness(results: Array<"idle" | "progress" | "error">) {
  const scheduled: Array<{
    task: () => void;
    delayMs: number;
    handle: object;
  }> = [];
  const cancelled: object[] = [];
  const scheduler: WebsiteInquiryAlertWorkerLoopScheduler = {
    schedule(task, delayMs) {
      const handle = {};
      scheduled.push({ task, delayMs, handle });
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle as object);
    },
  };
  const worker = {
    runOne: vi.fn(async (): Promise<{ kind: "idle" | "progress" }> => {
      const kind = results.shift() ?? "idle";
      if (kind === "error") throw new Error("database unavailable");
      return { kind };
    }),
  };
  const loop = new WebsiteInquiryAlertWorkerLoop({
    worker,
    workerId: "website-inquiry-worker-a",
    clock: { now: () => new Date("2026-09-03T16:00:00.000Z") },
    scheduler,
  });
  return { cancelled, loop, scheduled, worker };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("WebsiteInquiryAlertWorkerLoop", () => {
  it("starts once with an immediate first pass", () => {
    const h = harness([]);
    h.loop.start();
    h.loop.start();
    expect(h.scheduled.map(({ delayMs }) => delayMs)).toEqual([0]);
  });

  it.each([
    ["idle", 30_000],
    ["progress", 1_000],
    ["error", 60_000],
  ] as const)("schedules %s results after %i milliseconds", async (result, delayMs) => {
    const h = harness([result]);
    h.loop.start();
    h.scheduled.shift()?.task();
    await flush();
    expect(h.scheduled[0]?.delayMs).toBe(delayMs);
    await h.loop.close();
  });

  it("cancels pending work when closed", async () => {
    const h = harness([]);
    h.loop.start();
    const pending = h.scheduled[0]?.handle;
    await h.loop.close();
    expect(h.cancelled).toContain(pending);
  });

  it("waits for an active pass before closing", async () => {
    let finish!: (value: { kind: "idle" }) => void;
    const active = new Promise<{ kind: "idle" }>((resolve) => {
      finish = resolve;
    });
    const scheduled: Array<{ task: () => void; delayMs: number }> = [];
    const loop = new WebsiteInquiryAlertWorkerLoop({
      worker: { runOne: vi.fn(() => active) },
      workerId: "website-inquiry-worker-a",
      clock: { now: () => new Date("2026-09-03T16:00:00.000Z") },
      scheduler: {
        schedule(task, delayMs) {
          scheduled.push({ task, delayMs });
          return task;
        },
        cancel() {},
      },
    });
    loop.start();
    scheduled.shift()?.task();
    await Promise.resolve();

    let closed = false;
    const closing = loop.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish({ kind: "idle" });
    await closing;
    expect(closed).toBe(true);
    expect(scheduled).toHaveLength(0);
  });
});
