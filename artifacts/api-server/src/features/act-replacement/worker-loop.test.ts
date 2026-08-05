import { describe, expect, it } from "vitest";

import {
  ActExtractionWorkerLoop,
  type WorkerLoopScheduler,
} from "./worker-loop";

type Scheduled = { task: () => void; delayMs: number; cancelled: boolean };

function fixture(
  outcomes: Array<
    | { kind: "idle" }
    | { kind: "progress"; runId: string; checkpointId: string }
    | { kind: "retry_scheduled"; runId: string; checkpointId: string }
  >,
) {
  const scheduled: Scheduled[] = [];
  const calls: unknown[] = [];
  const scheduler: WorkerLoopScheduler = {
    schedule(task, delayMs) {
      const handle = { task, delayMs, cancelled: false };
      scheduled.push(handle);
      return handle;
    },
    cancel(handle) {
      (handle as Scheduled).cancelled = true;
    },
  };
  const loop = new ActExtractionWorkerLoop({
    worker: {
      async runOne(input) {
        calls.push(input);
        return outcomes.shift() ?? { kind: "idle" };
      },
    },
    workerId: "process-worker",
    clock: { now: () => new Date("2026-08-04T12:00:00.000Z") },
    scheduler,
  });
  return { loop, scheduled, calls };
}

async function run(task: Scheduled) {
  task.task();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ActExtractionWorkerLoop", () => {
  it("starts immediately and immediately schedules again after progress", async () => {
    const test = fixture([
      { kind: "progress", runId: "run-1", checkpointId: "checkpoint-1" },
    ]);

    test.loop.start();
    expect(test.scheduled.map(({ delayMs }) => delayMs)).toEqual([0]);
    await run(test.scheduled[0]!);

    expect(test.calls).toEqual([
      {
        workerId: "process-worker",
        now: new Date("2026-08-04T12:00:00.000Z"),
      },
    ]);
    expect(test.scheduled.map(({ delayMs }) => delayMs)).toEqual([0, 0]);
  });

  it("waits two seconds after an idle step", async () => {
    const test = fixture([{ kind: "idle" }]);

    test.loop.start();
    await run(test.scheduled[0]!);

    expect(test.scheduled.map(({ delayMs }) => delayMs)).toEqual([0, 2_000]);
  });

  it("single-flights even if a scheduler invokes a tick twice", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const test = fixture([]);
    test.loop = new ActExtractionWorkerLoop({
      worker: {
        async runOne(input) {
          test.calls.push(input);
          await pending;
          return { kind: "idle" };
        },
      },
      workerId: "process-worker",
      clock: { now: () => new Date("2026-08-04T12:00:00.000Z") },
      scheduler: {
        schedule(task, delayMs) {
          const handle = { task, delayMs, cancelled: false };
          test.scheduled.push(handle);
          return handle;
        },
        cancel(handle) {
          (handle as Scheduled).cancelled = true;
        },
      },
    });
    test.loop.start();

    test.scheduled[0]!.task();
    test.scheduled[0]!.task();
    await Promise.resolve();
    expect(test.calls).toHaveLength(1);

    release();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("cancels pending work and does not reschedule after close", async () => {
    const test = fixture([{ kind: "idle" }]);
    test.loop.start();

    await test.loop.close();

    expect(test.scheduled[0]?.cancelled).toBe(true);
    expect(test.calls).toHaveLength(0);
  });
});
