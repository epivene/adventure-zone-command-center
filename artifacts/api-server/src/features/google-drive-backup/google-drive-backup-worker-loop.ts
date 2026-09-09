import type { GoogleDriveBackupWorker, GoogleDriveBackupWorkerResult } from "./google-drive-backup-worker";

export class GoogleDriveBackupWorkerLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private running: Promise<void> | null = null;

  constructor(private readonly options: {
    worker: Pick<GoogleDriveBackupWorker, "runOnce">;
    idlePollMs?: number;
    now?: () => Date;
    onResult?: (result: GoogleDriveBackupWorkerResult) => void;
    onError?: (error: unknown) => void;
  }) {}

  start(): void {
    if (this.running || this.stopping) return;
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.tick().finally(() => {
        this.running = null;
      });
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let result: GoogleDriveBackupWorkerResult = "idle";
    try {
      result = await this.options.worker.runOnce(
        this.options.now?.() ?? new Date(),
      );
      this.options.onResult?.(result);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.schedule(
        result === "idle" ? this.options.idlePollMs ?? 2_000 : 0,
      );
    }
  }

  async close(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.running;
  }
}
