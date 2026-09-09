import { logger } from "@/lib/logger";

export const GOOGLE_HISTORICAL_BACKFILL_CONTINUE_DELAY_MS = 60 * 1_000;
export const GOOGLE_HISTORICAL_BACKFILL_IDLE_DELAY_MS = 60 * 60 * 1_000;

type ValidationStatus =
  | "not_started"
  | "ready_for_review"
  | "approved"
  | "rejected";

type HistoricalState = {
  status?: string;
  firstBatchApproved?: boolean;
};

type HistoricalBatchResult = {
  state?: string;
};

type HistoricalValidation = {
  getStatus(): Promise<ValidationStatus>;
};

type HistoricalRepository = {
  getState(): Promise<HistoricalState>;
};

type HistoricalService = {
  runNextBatch(): Promise<HistoricalBatchResult>;
};

type HistoricalLease = {
  recoverStale(): Promise<boolean>;
  acquire(): Promise<boolean>;
  heartbeat(): Promise<void>;
  markErrorIfRunning(): Promise<void>;
};

export interface GoogleHistoricalBackfillLoopScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemGoogleHistoricalBackfillLoopScheduler:
GoogleHistoricalBackfillLoopScheduler = {
  schedule(task, delayMs) {
    return setTimeout(task, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const localLease: HistoricalLease = {
  recoverStale: async () => false,
  acquire: async () => true,
  heartbeat: async () => undefined,
  markErrorIfRunning: async () => undefined,
};

function eligible(state: HistoricalState): boolean {
  if (state.status === "not_started") return true;
  return state.firstBatchApproved === true
    && (state.status === "ready" || state.status === "error");
}

export class GoogleHistoricalBackfillLoop {
  private readonly lease: HistoricalLease;
  private started = false;
  private stopped = false;
  private pending: unknown = null;
  private active: Promise<void> | null = null;

  constructor(private readonly dependencies: {
    enabled: boolean;
    validation: HistoricalValidation;
    repository: HistoricalRepository;
    service: HistoricalService;
    lease?: HistoricalLease;
    scheduler: GoogleHistoricalBackfillLoopScheduler;
  }) {
    this.lease = dependencies.lease ?? localLease;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    logger.info(
      { enabled: this.dependencies.enabled },
      "Historical Gmail catch-up worker started",
    );
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
    let nextDelayMs = GOOGLE_HISTORICAL_BACKFILL_IDLE_DELAY_MS;
    try {
      if (!this.dependencies.enabled) return;
      if ((await this.dependencies.validation.getStatus()) !== "approved") return;

      let state = await this.dependencies.repository.getState();
      if (state.status === "running") {
        if (!(await this.lease.recoverStale())) return;
        state = await this.dependencies.repository.getState();
      }
      if (!eligible(state)) return;
      if (!(await this.lease.acquire())) return;

      const heartbeat = setInterval(() => {
        void this.lease.heartbeat().catch(() => undefined);
      }, 30_000);
      heartbeat.unref?.();
      try {
        await this.lease.heartbeat();
        const result = await this.dependencies.service.runNextBatch();
        if (result.state === "ready") {
          nextDelayMs = GOOGLE_HISTORICAL_BACKFILL_CONTINUE_DELAY_MS;
        }
        logger.info(
          { state: result.state ?? "unknown" },
          "Historical Gmail catch-up batch completed",
        );
      } catch (error) {
        await this.lease.markErrorIfRunning().catch(() => undefined);
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      logger.warn(
        { errorCode: error instanceof Error ? error.message : "unknown" },
        "Historical Gmail catch-up deferred",
      );
    } finally {
      this.schedule(nextDelayMs);
    }
  }
}
