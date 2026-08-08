import type {
  ActExtractionStepResult,
  ActExtractionWorker,
} from "./extraction-worker";
import { logger } from "@/lib/logger";

export interface WorkerLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

type Worker = Pick<ActExtractionWorker, "runOne">;
type Clock = { now(): Date };

export const systemWorkerLoopScheduler: WorkerLoopScheduler = {
  schedule(task, delayMs) {
    return setTimeout(task, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class ActExtractionWorkerLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;

  constructor(
    private readonly dependencies: {
      worker: Worker;
      workerId: string;
      clock: Clock;
      scheduler: WorkerLoopScheduler;
    },
  ) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
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
    let result: ActExtractionStepResult = { kind: "idle" };
    try {
      result = await this.dependencies.worker.runOne({
        workerId: this.dependencies.workerId,
        now: this.dependencies.clock.now(),
      });
    } catch (err) {
      // A failed process-local step owns no durable run state. The next tick
      // will claim whatever durable work is eligible after the idle delay.
      logger.error(
        {
          errorCode:
            err && typeof err === "object" && "code" in err
              ? String((err as { code?: unknown }).code)
              : "unknown",
        },
        "Act extraction worker step failed outside durable error handling",
      );
    }
    if (!this.stopped) this.schedule(result.kind === "idle" ? 2_000 : 0);
  }
}

export type OrganizerLoopWorker = { runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }>; };

/** Generic durable organizer scheduler; durable claims make restart-safe. */
export class ActOrganizerWorkerLoop {
  private started = false; private stopped = false; private pending: unknown = null; private active: Promise<void> | null = null;
  constructor(private readonly dependencies: { worker: OrganizerLoopWorker; workerId: string; clock: Clock; scheduler: WorkerLoopScheduler }) {}
  start() { if (this.started || this.stopped) return; this.started = true; this.schedule(0); }
  async close() { this.stopped = true; if (this.pending !== null) { this.dependencies.scheduler.cancel(this.pending); this.pending = null; } await this.active; }
  private schedule(delayMs: number) { if (this.stopped) return; let handle: unknown; handle = this.dependencies.scheduler.schedule(() => { if (this.pending === handle) this.pending = null; this.tick(); }, delayMs); this.pending = handle; }
  private tick() { if (this.stopped || this.active) return; const active = this.step(); this.active = active; void active.finally(() => { if (this.active === active) this.active = null; }); }
  private async step() { let result: { kind: "idle" | "progress" } = { kind: "idle" }; try { result = await this.dependencies.worker.runOne({ workerId: this.dependencies.workerId, now: this.dependencies.clock.now() }); } catch { /* durable claim remains eligible */ } if (!this.stopped) this.schedule(result.kind === "idle" ? 2_000 : 0); }
}
