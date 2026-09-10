import { describe, expect, it, vi } from "vitest";
import type { GoogleRecentValidationResult } from "./google-recent-validation-service";

import {
  GOOGLE_RECENT_EMAIL_SYNC_LIMIT,
  GOOGLE_SENT_PROFILE_LINK_CATCHUP_INTERVAL_MS,
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

function emptyRecentResult(): GoogleRecentValidationResult {
  return {
    checkedLimit: 100,
    aiEnabled: false,
    historicalImportStarted: false,
    validationStatus: "approved",
    counts: { discovered: 0, matched: 0, needsReview: 0, ignored: 0 },
    matched: [],
    needsReview: [],
    ignored: [],
  };
}

describe("GoogleSentProfileLinkSweepLoop", () => {
  it("keeps late-August sent mail inside the September catch-up window", () => {
    const septemberTenth = Date.parse("2026-09-10T13:00:00.000Z");
    const augustTwentyFifth = Date.parse("2026-08-25T00:00:00.000Z");

    expect(septemberTenth - GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS)
      .toBeLessThanOrEqual(augustTwentyFifth);
  });

  it("reconciles recent all-mail hourly and runs the sent-mail catch-up daily", async () => {
    let now = new Date("2026-08-31T21:30:00.000Z");
    const recentRun = vi.fn().mockResolvedValue({
      counts: { discovered: 10, matched: 2, needsReview: 1, ignored: 7 },
    });
    const sentRun = vi.fn().mockResolvedValue({
      counts: { sentInWindow: 20, alreadyLinked: 18, linked: 2, needsReview: 0, ignored: 0, failed: 0 },
    });
    const scheduler = new FakeScheduler();
    const loop = new GoogleSentProfileLinkSweepLoop({
      recent: { run: recentRun },
      sentSweep: { run: sentRun },
      clock: { now: () => new Date(now) },
      scheduler,
    });

    loop.start();
    expect(scheduler.scheduled.map((row) => row.delayMs)).toEqual([0]);

    scheduler.run(0);
    await settle();

    expect(recentRun).toHaveBeenCalledWith(
      GOOGLE_RECENT_EMAIL_SYNC_LIMIT,
      { skipProcessed: true },
    );
    expect(sentRun).toHaveBeenCalledWith({
      after: new Date(now.getTime() - GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS),
      before: now,
      repair: true,
    });
    expect(scheduler.scheduled[1]?.delayMs).toBe(GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS);

    now = new Date(now.getTime() + GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS);
    scheduler.run(1);
    await settle();
    expect(recentRun).toHaveBeenCalledTimes(2);
    expect(sentRun).toHaveBeenCalledTimes(1);

    now = new Date(now.getTime() + GOOGLE_SENT_PROFILE_LINK_CATCHUP_INTERVAL_MS);
    scheduler.run(2);
    await settle();
    expect(recentRun).toHaveBeenCalledTimes(3);
    expect(sentRun).toHaveBeenCalledTimes(2);

    await loop.close();
  });

  it("does not overlap a still-running sweep and waits for it during shutdown", async () => {
    let resolveRun!: () => void;
    const recentRun = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveRun = resolve;
      });
      return emptyRecentResult();
    });
    const scheduler = new FakeScheduler();
    const loop = new GoogleSentProfileLinkSweepLoop({
      recent: { run: recentRun },
      sentSweep: { run: vi.fn().mockResolvedValue({ counts: {} }) },
      clock: { now: () => new Date("2026-08-31T21:30:00.000Z") },
      scheduler,
    });

    loop.start();
    scheduler.run(0);
    expect(recentRun).toHaveBeenCalledTimes(1);

    const closing = loop.close();
    let closed = false;
    void closing.then(() => { closed = true; });
    await settle();
    expect(closed).toBe(false);

    resolveRun();
    await closing;
    expect(closed).toBe(true);
    expect(scheduler.scheduled).toHaveLength(1);
  });

  it("keeps the loop alive after a failed sweep", async () => {
    const scheduler = new FakeScheduler();
    const loop = new GoogleSentProfileLinkSweepLoop({
      recent: { run: vi.fn().mockRejectedValue(new Error("temporary")) },
      sentSweep: { run: vi.fn().mockRejectedValue(new Error("temporary")) },
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
