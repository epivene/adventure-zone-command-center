import { logger } from "@/lib/logger";
import type { EarlyBirdPromoWorker } from "./early-bird-promo-worker";

export interface EarlyBirdPromoWorkerLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemEarlyBirdPromoWorkerLoopScheduler: EarlyBirdPromoWorkerLoopScheduler = {
  schedule(task, delayMs) { return setTimeout(task, delayMs); },
  cancel(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export class EarlyBirdPromoWorkerLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;

  constructor(private readonly dependencies: {
    worker: Pick<EarlyBirdPromoWorker, "runOne">;
    workerId: string;
    clock: { now(): Date };
    scheduler: EarlyBirdPromoWorkerLoopScheduler;
  }) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    logger.info("Early Bird Promo reminder worker started");
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
    let delay = 15_000;
    try {
      const result = await this.dependencies.worker.runOne({
        workerId: this.dependencies.workerId,
        now: this.dependencies.clock.now(),
      });
      delay = result.kind === "progress" ? 1_000 : 15_000;
    } catch (error) {
      delay = 60_000;
      logger.error({ error }, "Early Bird Promo reminder step failed");
    }
    if (!this.stopped) this.schedule(delay);
  }
}
