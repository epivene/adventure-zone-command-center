import { logger } from "@/lib/logger";
import type { LeadScoutWorker } from "./lead-scout-worker";

export interface LeadScoutWorkerLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemLeadScoutWorkerLoopScheduler: LeadScoutWorkerLoopScheduler = {
  schedule(task, delayMs) { return setTimeout(task, delayMs); },
  cancel(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

type Worker = Pick<LeadScoutWorker, "runOne">;
type Clock = { now(): Date };

export class LeadScoutWorkerLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;

  constructor(private readonly dependencies: {
    worker: Worker;
    workerId: string;
    clock: Clock;
    scheduler: LeadScoutWorkerLoopScheduler;
  }) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    logger.info("Lead Scout worker started");
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

  private schedule(delayMs: number) {
    if (this.stopped) return;
    let handle: unknown;
    handle = this.dependencies.scheduler.schedule(() => {
      if (this.pending === handle) this.pending = null;
      this.tick();
    }, delayMs);
    this.pending = handle;
  }

  private tick() {
    if (this.stopped || this.active) return;
    const active = this.runStep();
    this.active = active;
    void active.finally(() => {
      if (this.active === active) this.active = null;
    });
  }

  private async runStep() {
    let result: { kind: "idle" | "progress" } = { kind: "idle" };
    try {
      result = await this.dependencies.worker.runOne({
        workerId: this.dependencies.workerId,
        now: this.dependencies.clock.now(),
      });
    } catch (error) {
      logger.error({
        errorCode: error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "unknown",
      }, "Lead Scout worker step failed outside durable error handling");
    }
    if (!this.stopped) this.schedule(result.kind === "idle" ? 2_000 : 0);
  }
}
