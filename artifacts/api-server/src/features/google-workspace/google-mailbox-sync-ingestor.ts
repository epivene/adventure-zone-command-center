import {
  SyncFailure,
  type MailboxChangeClient,
} from "./google-mailbox-sync-client";
import {
  SyncRepository,
  type AccountClaim,
  type Checkpoint,
} from "./google-mailbox-sync-repository";
export class MailboxSyncIngestor {
  constructor(
    private repo: SyncRepository,
    private client: MailboxChangeClient,
    private now = () => Date.now(),
  ) {}
  async step(
    a: AccountClaim,
  ): Promise<{ phase: string; queued: number; hasMore: boolean }> {
    const c = a.checkpoint;
    let next: Checkpoint = { ...c },
      threads: string[] = [];
    try {
      if (c.phase === "boundary") {
        const mailbox = await this.client.getMailbox();
        if (mailbox.email.toLowerCase() !== a.email.toLowerCase())
          throw new SyncFailure("auth", "SYNC_ACCOUNT_CHANGED");
        next = {
          phase: "mapped",
          boundary: mailbox.historyId,
          after: Math.floor(this.now() / 1000) - 90 * 86400,
          before: Math.floor(this.now() / 1000) + 1,
        };
      } else if (c.phase === "mapped") {
        threads = (
          await this.repo.db.query<{ thread_id: string }>(
            `SELECT DISTINCT m.thread_id FROM google_workspace_validation_mappings m WHERE m.connection_id=$1 AND m.thread_id>$2 AND ($3=0 OR EXISTS(SELECT 1 FROM google_sync_enrollments e WHERE e.connection_id=m.connection_id AND e.profile_id=m.organization_id)) ORDER BY m.thread_id LIMIT 100`,
            [a.connectionId, c.mappedAfter ?? "", a.cohortLimit],
          )
        ).rows.map((r) => r.thread_id);
        next = {
          ...c,
          phase: threads.length === 100 ? "mapped" : "recent",
          mappedAfter: threads.at(-1) ?? c.mappedAfter,
        };
      } else if (c.phase === "recent" || c.phase === "drafts") {
        const page =
          c.phase === "recent"
            ? await this.client.listMessagesPage({
                query: `after:${c.after} before:${c.before}`,
                pageToken: c.pageToken ?? undefined,
              })
            : await this.client.listDraftsPage(c.pageToken ?? undefined);
        threads = page.messages.map((m) => m.threadId);
        next = {
          ...c,
          phase: page.nextPageToken
            ? c.phase
            : c.phase === "recent"
              ? "drafts"
              : "history",
          pageToken: page.nextPageToken,
        };
      } else {
        const page = await this.client.listHistory({
          startHistoryId: c.cursor ?? c.boundary!,
          pageToken: c.pageToken ?? undefined,
        });
        threads = page.changedThreads;
        next = page.nextPageToken
          ? { ...c, phase: "history", pageToken: page.nextPageToken }
          : { phase: "ready", cursor: page.historyId };
      }
    } catch (error) {
      if (error instanceof SyncFailure && error.kind === "expired_cursor")
        next = { phase: "boundary" };
      else if (
        error instanceof SyncFailure &&
        error.code === "SYNC_PAGE_TOKEN_INVALID" &&
        c.pageToken
      )
        next = { ...c, pageToken: null };
      else throw error;
    }
    if (!(await this.repo.commitPage(a, { threads, checkpoint: next })))
      throw new SyncFailure("retryable", "SYNC_LEASE_LOST");
    return {
      phase: next.phase,
      queued: new Set(threads).size,
      hasMore: next.phase !== "ready",
    };
  }
}
