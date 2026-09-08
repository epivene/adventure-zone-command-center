import type { MarketingService } from "./marketing-service";

/** Bounded single-process poller. Database state claiming makes concurrent API instances safe. */
export class MarketingCampaignWorkerLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(
    private readonly service: MarketingService,
    private readonly onError: (error: unknown) => void,
    private readonly intervalMs = 60_000,
  ) {}

  start() {
    if (this.timer) return;
    const run = async () => {
      if (this.running) return;
      this.running = true;
      try { await this.service.dispatchDue(); }
      catch (error) { this.onError(error); }
      finally { this.running = false; }
    };
    // This only queries scheduled rows; delivery is still guarded by state and snapshot claims.
    void run();
    this.timer = setInterval(() => void run(), this.intervalMs);
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}