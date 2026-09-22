import { logger } from "@/lib/logger";
import type { CoverageWorker } from "./coverage-worker";

export interface CoverageWorkerLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemCoverageWorkerLoopScheduler: CoverageWorkerLoopScheduler = {
  schedule(task, delayMs) { return setTimeout(task, delayMs); },
  cancel(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

export class CoverageWorkerLoop {
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;
  constructor(private readonly dependencies: {
    worker: Pick<CoverageWorker, "runOne">;
    workerId: string;
    scheduler: CoverageWorkerLoopScheduler;
    clock: { now(): Date };
  }) {}
  start() { if (!this.stopped && this.pending === null) this.schedule(0); }
  async close() {
    this.stopped = true;
    if (this.pending !== null) this.dependencies.scheduler.cancel(this.pending);
    this.pending = null;
    await this.active;
  }
  private schedule(delayMs: number) {
    if (this.stopped) return;
    this.pending = this.dependencies.scheduler.schedule(() => {
      this.pending = null;
      const current = this.tick();
      this.active = current;
      void current.finally(() => { if (this.active === current) this.active = null; });
    }, delayMs);
  }
  private async tick() {
    let delay = 15_000;
    try {
      const result = await this.dependencies.worker.runOne({ workerId: this.dependencies.workerId, now: this.dependencies.clock.now() });
      delay = result.kind === "progress" ? 1_000 : result.kind === "failed" ? result.retryAfterMs : 15_000;
    } catch (error) {
      logger.error({ error }, "Event date coverage worker step failed");
      delay = 60_000;
    }
    this.schedule(delay);
  }
}
