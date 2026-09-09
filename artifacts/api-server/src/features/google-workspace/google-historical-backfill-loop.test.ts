import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_HISTORICAL_BACKFILL_CONTINUE_DELAY_MS,
  GOOGLE_HISTORICAL_BACKFILL_IDLE_DELAY_MS,
  GoogleHistoricalBackfillLoop,
  type GoogleHistoricalBackfillLoopScheduler,
} from "./google-historical-backfill-loop";

class FakeScheduler implements GoogleHistoricalBackfillLoopScheduler {
  readonly scheduled: Array<{ task: () => void; delayMs: number; cancelled: boolean }> = [];

  schedule(task: () => void, delayMs: number): unknown {
    const row = { task, delayMs, cancelled: false };
    this.scheduled.push(row);
    return row;
  }

  cancel(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }

  run(index: number): void {
    const row = this.scheduled[index];
    if (!row || row.cancelled) throw new Error(`Scheduled task ${index} is unavailable.`);
    row.task();
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("GoogleHistoricalBackfillLoop", () => {
  it("prepares the first approved 100-message batch, then stops at owner approval", async () => {
    const scheduler = new FakeScheduler();
    const runNextBatch = vi.fn().mockResolvedValue({ state: "awaiting_approval" });
    const loop = new GoogleHistoricalBackfillLoop({
      enabled: true,
      validation: { getStatus: async () => "approved" },
      repository: {
        getState: async () => ({
          status: "not_started",
          firstBatchApproved: false,
        }),
      },
      service: { runNextBatch },
      scheduler,
    });

    loop.start();
    scheduler.run(0);
    await settle();

    expect(runNextBatch).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled[1]?.delayMs).toBe(
      GOOGLE_HISTORICAL_BACKFILL_IDLE_DELAY_MS,
    );
    await loop.close();
  });

  it("continues approved historical batches without crossing the first-batch gate", async () => {
    const scheduler = new FakeScheduler();
    const runNextBatch = vi.fn().mockResolvedValue({ state: "ready" });
    const states = [
      { status: "ready", firstBatchApproved: true },
      { status: "awaiting_approval", firstBatchApproved: false },
    ];
    const loop = new GoogleHistoricalBackfillLoop({
      enabled: true,
      validation: { getStatus: async () => "approved" },
      repository: { getState: async () => states.shift()! },
      service: { runNextBatch },
      scheduler,
    });

    loop.start();
    scheduler.run(0);
    await settle();
    expect(runNextBatch).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled[1]?.delayMs).toBe(
      GOOGLE_HISTORICAL_BACKFILL_CONTINUE_DELAY_MS,
    );

    scheduler.run(1);
    await settle();
    expect(runNextBatch).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled[2]?.delayMs).toBe(
      GOOGLE_HISTORICAL_BACKFILL_IDLE_DELAY_MS,
    );
    await loop.close();
  });

  it("does nothing while historical sync or recent validation is unapproved", async () => {
    for (const input of [
      { enabled: false, validationStatus: "approved" as const },
      { enabled: true, validationStatus: "ready_for_review" as const },
    ]) {
      const scheduler = new FakeScheduler();
      const runNextBatch = vi.fn();
      const getState = vi.fn().mockResolvedValue({
        status: "not_started",
        firstBatchApproved: false,
      });
      const loop = new GoogleHistoricalBackfillLoop({
        enabled: input.enabled,
        validation: { getStatus: async () => input.validationStatus },
        repository: { getState },
        service: { runNextBatch },
        scheduler,
      });

      loop.start();
      scheduler.run(0);
      await settle();

      expect(runNextBatch).not.toHaveBeenCalled();
      if (!input.enabled) expect(getState).not.toHaveBeenCalled();
      await loop.close();
    }
  });
});
