import type { VoicemailRetentionWorker } from "./voicemail-retention-worker";
export const VOICEMAIL_RETENTION_INTERVAL_MS = 15 * 60_000;
export class VoicemailRetentionWorkerLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly worker: VoicemailRetentionWorker, private readonly enabled: () => boolean, private readonly onError: (error: unknown) => void) {}
  start() {
    if (this.timer || !this.enabled()) return;
    void this.worker.run().catch(this.onError);
    this.timer = setInterval(() => void this.worker.run().catch(this.onError), VOICEMAIL_RETENTION_INTERVAL_MS);
  }
  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}