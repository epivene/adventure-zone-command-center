import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS,
  GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS,
  GoogleSentProfileLinkSweepLoop,
  type GoogleSentProfileLinkSweepLoopScheduler,
} from "./google-sent-profile-link-sweep-loop";

class FakeScheduler implements GoogleSentProfileLinkSweepLoopScheduler {
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

describe("GoogleSentProfileLinkSweepLoop", () => {
  it("repairs a rolling recent sent-mail window immediately and on a fixed interval", async () => {
    const now = new Date("2026-08-31T21:30:00.000Z");
    const run = vi.fn().mockResolvedValue({ counts: { linked: 2, needsReview: 1, failed: 0 } });
    const scheduler = new FakeScheduler();
    const loop = new GoogleSentProfileLinkSweepLoop({
      sweep: { run },
      clock: { now: () => new Date(now) },
      scheduler,
    });

    loop.start();
    expect(scheduler.scheduled.map((row) => row.delayMs)).toEqual([0]);

    scheduler.run(0);
    await settle();

    expect(run).toHaveBeenCalledWith({
      after: new Date(now.getTime() - GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS),
      before: now,
      repair: true,
    });
    expect(scheduler.scheduled[1]?.delayMs).toBe(GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS);

    scheduler.run(1);
    await settle();
    expect(run).toHaveBeenCalledTimes(2);

    await loop.close();
  });

  it("does not overlap a still-running sweep and waits for it during shutdown", async () => {
    let resolveRun: (() => void) | null = null;
    const run = vi.fn(() => new Promise<void>((resolve) => {
      resolveRun = resolve;
    }));
    const scheduler = new FakeScheduler();
    const loop = new GoogleSentProfileLinkSweepLoop({
      sweep: { run },
      clock: { now: () => new Date("2026-08-31T21:30:00.000Z") },
      scheduler,
    });

    loop.start();
    scheduler.run(0);
    expect(run).toHaveBeenCalledTimes(1);

    const closing = loop.close();
    let closed = false;
    void closing.then(() => { closed = true; });
    await settle();
    expect(closed).toBe(false);

    resolveRun?.();
    await closing;
    expect(closed).toBe(true);
    expect(scheduler.scheduled).toHaveLength(1);
  });

  it("keeps the loop alive after a failed sweep", async () => {
    const scheduler = new FakeScheduler();
    const loop = new GoogleSentProfileLinkSweepLoop({
      sweep: { run: vi.fn().mockRejectedValue(new Error("temporary")) },
      clock: { now: () => new Date("2026-08-31T21:30:00.000Z") },
      scheduler,
    });

    loop.start();
    scheduler.run(0);
    await settle();

    expect(scheduler.scheduled[1]?.delayMs).toBe(GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS);
    await loop.close();
  });
});
