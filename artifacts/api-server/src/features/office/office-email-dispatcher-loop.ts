export type OfficeEmailLoopScheduler = {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
};

const defaultScheduler: OfficeEmailLoopScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class OfficeEmailDispatcherLoop {
  private handle: unknown = null;
  private running = false;

  constructor(
    private readonly deps: {
      runOne(input: {
        workerId: string;
        now: Date;
      }): Promise<"sent" | "idle" | "failed">;
      workerId: string;
      scheduler?: OfficeEmailLoopScheduler;
      now?: () => Date;
      onError?: (error: unknown) => void;
    },
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.queue(0);
  }

  stop() {
    this.running = false;
    if (this.handle !== null) {
      (this.deps.scheduler ?? defaultScheduler).cancel(this.handle);
      this.handle = null;
    }
  }

  private queue(delayMs: number) {
    if (!this.running) return;
    this.handle = (this.deps.scheduler ?? defaultScheduler).schedule(
      () => void this.tick(),
      delayMs,
    );
  }

  private async tick() {
    if (!this.running) return;
    this.handle = null;
    try {
      const result = await this.deps.runOne({
        workerId: this.deps.workerId,
        now: this.deps.now?.() ?? new Date(),
      });
      this.queue(result === "idle" ? 15_000 : 1_000);
    } catch (error) {
      this.deps.onError?.(error);
      this.queue(60_000);
    }
  }
}
