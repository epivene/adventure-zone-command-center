import { logger } from "@/lib/logger";
import type { WebsiteInquiryAlertWorker } from "./website-inquiry-alert-worker";

export interface WebsiteInquiryAlertWorkerLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemWebsiteInquiryAlertWorkerLoopScheduler: WebsiteInquiryAlertWorkerLoopScheduler = {
  schedule(task, delayMs) {
    return setTimeout(task, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

type Worker = Pick<WebsiteInquiryAlertWorker, "runOne">;
type Clock = { now(): Date };

export class WebsiteInquiryAlertWorkerLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;

  constructor(
    private readonly dependencies: {
      worker: Worker;
      workerId: string;
      clock: Clock;
      scheduler: WebsiteInquiryAlertWorkerLoopScheduler;
    },
  ) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    logger.info("Website inquiry alert worker started");
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
    let nextDelayMs = 30_000;
    try {
      const result = await this.dependencies.worker.runOne({
        workerId: this.dependencies.workerId,
        now: this.dependencies.clock.now(),
      });
      nextDelayMs = result.kind === "idle" ? 30_000 : 1_000;
    } catch (error) {
      nextDelayMs = 60_000;
      logger.error(
        {
          errorCode:
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code)
              : "unknown",
        },
        "Website inquiry alert worker failed outside durable error handling",
      );
    }
    if (!this.stopped) this.schedule(nextDelayMs);
  }
}
