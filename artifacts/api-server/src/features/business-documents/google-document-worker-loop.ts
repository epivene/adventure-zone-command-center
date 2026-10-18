import { logger } from "@/lib/logger";
import type { GoogleDocumentWorker } from "./google-document-worker";

export const GOOGLE_DOCUMENT_INTERVAL_MS = 60 * 60 * 1_000;
export interface GoogleDocumentWorkerLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
export const systemGoogleDocumentWorkerLoopScheduler: GoogleDocumentWorkerLoopScheduler = {
  schedule: (task, delayMs) => setTimeout(task, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class GoogleDocumentWorkerLoop {
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;
  constructor(private readonly dependencies: {
    worker: Pick<GoogleDocumentWorker, "runOnce">;
    clock: { now(): Date };
    scheduler: GoogleDocumentWorkerLoopScheduler;
    runExclusive?:(work:()=>Promise<void>)=>Promise<void>;
  }) {}
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(0);
  }
  async close() {
    this.stopped = true;
    if (this.pending !== null) this.dependencies.scheduler.cancel(this.pending);
    this.pending = null;
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
    const active = this.run();
    this.active = active;
    void active.finally(() => { if (this.active === active) this.active = null; });
  }
  private async run() {
    try {
      const work=async()=>{
      const summary = await this.dependencies.worker.runOnce(this.dependencies.clock.now());
      logger.info(summary, summary.connected ? "Hourly Gmail document intake completed" : "Hourly Gmail document intake skipped; Workspace is disconnected");
      };
      if(this.dependencies.runExclusive)await this.dependencies.runExclusive(work);else await work();
    } catch (error) {
      logger.warn({ errorCode: error instanceof Error ? error.message : "unknown" }, "Hourly Gmail document intake deferred");
    } finally {
      if (!this.stopped) this.schedule(GOOGLE_DOCUMENT_INTERVAL_MS);
    }
  }
}
