import { logger } from "@/lib/logger";
import type { GoogleSentProfileLinkSweepService } from "./google-sent-profile-link-sweep-service";

export const GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1_000;
export const GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

export interface GoogleSentProfileLinkSweepLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemGoogleSentProfileLinkSweepLoopScheduler:
GoogleSentProfileLinkSweepLoopScheduler = {
  schedule(task, delayMs) {
    return setTimeout(task, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

type Sweep = Pick<GoogleSentProfileLinkSweepService, "run">;
type Clock = { now(): Date };

export class GoogleSentProfileLinkSweepLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;

  constructor(private readonly dependencies: {
    sweep: Sweep;
    clock: Clock;
    scheduler: GoogleSentProfileLinkSweepLoopScheduler;
  }) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    logger.info("Recent sent Gmail profile-link repair worker started");
    this.schedule(0);
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.pending !== null) {
      this.dependencies.scheduler.cancel(this.pending);
      this.pending = null;
    }
    await this.active;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    let handle: unknown;
    handle = this.dependencies.scheduler.schedule(() => {
      if (this.pending === handle) this.pending = null;
      this.tick();
    }, delayMs);
    this.pending = handle;
  }

  private tick(): void {
    if (this.stopped || this.active) return;
    const active = this.runStep();
    this.active = active;
    void active.finally(() => {
      if (this.active === active) this.active = null;
    });
  }

  private async runStep(): Promise<void> {
    const now = this.dependencies.clock.now();
    try {
      const result = await this.dependencies.sweep.run({
        after: new Date(now.getTime() - GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS),
        before: now,
        repair: true,
      });
      logger.info(
        {
          sentInWindow: result.counts.sentInWindow,
          alreadyLinked: result.counts.alreadyLinked,
          linked: result.counts.linked,
          needsReview: result.counts.needsReview,
          ignored: result.counts.ignored,
          failed: result.counts.failed,
        },
        "Recent sent Gmail profile-link repair completed",
      );
    } catch (error) {
      logger.warn(
        {
          errorCode: error instanceof Error ? error.message : "unknown",
        },
        "Recent sent Gmail profile-link repair deferred",
      );
    }
    if (!this.stopped) {
      this.schedule(GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS);
    }
  }
}
