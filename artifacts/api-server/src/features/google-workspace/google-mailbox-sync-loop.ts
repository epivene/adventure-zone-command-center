import { syncFailure } from "./google-mailbox-sync-client";
import type {
  SyncRepository,
  AccountClaim,
  ThreadClaim,
} from "./google-mailbox-sync-repository";
export async function runMailboxTurn(input: {
  repo: SyncRepository;
  connectionId: string;
  ingest: (a: AccountClaim) => Promise<unknown>;
  process: (c: ThreadClaim, a: AccountClaim) => Promise<void>;
  archive?: (a: AccountClaim) => Promise<void>;
  historyDue: boolean;
  now?: () => number;
  stopped?: () => boolean;
}): Promise<{ processed: number }> {
  const now = input.now ?? Date.now,
    started = now();
  let processed = 0;
  const a = await input.repo.claimAccount(input.connectionId);
  if (!a) return { processed };
  let delay = 0,
    errorCode: string | null = null;
  try {
    if (input.historyDue || a.checkpoint.phase !== "ready")
      await input.ingest(a);
    const current = await input.repo.current(a);
    if (!current) return { processed };
    while (processed < 25 && now() - started < 30000 && !input.stopped?.()) {
      if (!(await input.repo.renew(current))) break;
      const [claim] = await input.repo.claimThreads(current, 1);
      if (!claim) break;
      await input.process(claim, current);
      processed++;
    }
    if (
      !input.stopped?.() &&
      now() - started < 30000 &&
      input.archive &&
      (await input.repo.renew(current))
    )
      await input.archive(current);
  } catch (e) {
    const failure = syncFailure(e);
    delay =
      failure.kind === "auth"
        ? 3600000
        : Math.max(60000, failure.retryAfterMs ?? 0);
    errorCode = failure.code;
  } finally {
    await input.repo.release(a, delay, errorCode);
  }
  return { processed };
}
export class MailboxSyncLoop {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private active: Promise<unknown> | null = null;
  constructor(
    private tick: (
      stopped: () => boolean,
    ) => Promise<{ nextDelayMs?: number } | void>,
    private onError: () => void = () => {},
  ) {}
  start() {
    if (this.timer || this.active || this.stopped) return;
    this.schedule(0);
  }
  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      let delay = 60000;
      this.active = this.tick(() => this.stopped)
        .then((result) => {
          delay = result?.nextDelayMs ?? 60000;
        })
        .catch(() => this.onError())
        .finally(() => {
          this.active = null;
          this.schedule(delay);
        });
    }, ms);
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }
}
