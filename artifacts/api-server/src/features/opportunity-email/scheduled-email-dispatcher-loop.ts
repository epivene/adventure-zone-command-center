import { logger } from "@/lib/logger";
import type { ScheduledEmailDispatcher } from "./scheduled-email-dispatcher";

export interface ScheduledEmailDispatcherLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemScheduledEmailDispatcherLoopScheduler: ScheduledEmailDispatcherLoopScheduler = {
  schedule(task, delayMs) { return setTimeout(task, delayMs); },
  cancel(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};

type Dispatcher = Pick<ScheduledEmailDispatcher, "runOne">;
type Clock = { now(): Date };

const IDLE_RETRY_MS = 15_000;
const PROGRESS_RETRY_MS = 1_000;
const ERROR_RETRY_MS = 60_000;

export class ScheduledEmailDispatcherLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;

  constructor(private readonly dependencies: {
    dispatcher: Dispatcher;
    workerId: string;
    clock: Clock;
    scheduler: ScheduledEmailDispatcherLoopScheduler;
  }) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    logger.info("Scheduled email dispatcher started");
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
    let retryMs = IDLE_RETRY_MS;
    try {
      const result = await this.dependencies.dispatcher.runOne({
        workerId: this.dependencies.workerId,
        now: this.dependencies.clock.now(),
      });
      retryMs = result.kind === "idle" ? IDLE_RETRY_MS : PROGRESS_RETRY_MS;
    } catch (error) {
      retryMs = ERROR_RETRY_MS;
      logger.error({
        errorCode: error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "unknown",
      }, "Scheduled email dispatcher step failed outside durable error handling");
    }
    if (!this.stopped) this.schedule(retryMs);
  }
}
