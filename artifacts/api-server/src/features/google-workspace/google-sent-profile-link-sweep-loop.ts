import { logger } from "@/lib/logger";
import type { GoogleRecentValidationService } from "./google-recent-validation-service";
import type { GoogleSentProfileLinkSweepService } from "./google-sent-profile-link-sweep-service";

export const GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1_000;
export const GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;
export const GOOGLE_SENT_PROFILE_LINK_CATCHUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const GOOGLE_RECENT_EMAIL_SYNC_LIMIT = 100;

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
type Recent = Pick<GoogleRecentValidationService, "run">;
type Clock = { now(): Date };

export class GoogleSentProfileLinkSweepLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;
  private lastSentCatchupAtMs: number | null = null;

  constructor(private readonly dependencies: {
    recent: Recent;
    sentSweep: Sweep;
    clock: Clock;
    scheduler: GoogleSentProfileLinkSweepLoopScheduler;
    pilot?: { run(): Promise<void> };
    runExclusive?: (work:()=>Promise<void>)=>Promise<void>;
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
    try {
      if(this.dependencies.runExclusive)await this.dependencies.runExclusive(()=>this.performStep());
      else await this.performStep();
    } catch { logger.warn('Gmail scheduled owner unavailable; checks deferred'); }
    finally {if(!this.stopped)this.schedule(GOOGLE_SENT_PROFILE_LINK_SWEEP_INTERVAL_MS);}
  }

  private async performStep(): Promise<void> {
    const now = this.dependencies.clock.now();
    try { if(this.dependencies.pilot) await this.dependencies.pilot.run(); }
    catch { logger.warn("Three-customer Gmail pilot sync deferred"); }
    try {
      const result = await this.dependencies.recent.run(
        GOOGLE_RECENT_EMAIL_SYNC_LIMIT,
        { skipProcessed: true },
      );
      logger.info(
        result.counts,
        "Recent Gmail profile-link reconciliation completed",
      );
    } catch (error) {
      logger.warn(
        { errorCode: error instanceof Error ? error.message : "unknown" },
        "Recent Gmail profile-link reconciliation deferred",
      );
    }

    const shouldRunSentCatchup = this.lastSentCatchupAtMs === null
      || now.getTime() - this.lastSentCatchupAtMs >= GOOGLE_SENT_PROFILE_LINK_CATCHUP_INTERVAL_MS;
    if (shouldRunSentCatchup) {
      try {
        const result = await this.dependencies.sentSweep.run({
          after: new Date(now.getTime() - GOOGLE_SENT_PROFILE_LINK_LOOKBACK_MS),
          before: now,
          repair: true,
        });
        this.lastSentCatchupAtMs = now.getTime();
        logger.info(
          {
            sentInWindow: result.counts.sentInWindow,
            alreadyLinked: result.counts.alreadyLinked,
            linked: result.counts.linked,
            needsReview: result.counts.needsReview,
            ignored: result.counts.ignored,
            failed: result.counts.failed,
          },
          "Recent sent Gmail profile-link catch-up completed",
        );
      } catch (error) {
        logger.warn(
          { errorCode: error instanceof Error ? error.message : "unknown" },
          "Recent sent Gmail profile-link catch-up deferred",
        );
      }
    }
  }
}
