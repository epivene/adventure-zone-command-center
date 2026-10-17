import {
  SyncRepository,
  type AccountClaim,
} from "./google-mailbox-sync-repository";
export class SyncArchiveWorker {
  constructor(
    private repo: SyncRepository,
    private archive: (
      job: { threadId: string; profileId: string; attempts: number },
      account: AccountClaim,
    ) => Promise<boolean>,
  ) {}
  async step(a: AccountClaim): Promise<boolean> {
    if (a.mode !== "active" || !(await this.repo.renew(a))) return false;
    const job = (
      await this.repo.db.query(
        `SELECT * FROM google_sync_archive_jobs WHERE connection_id=$1 AND status='pending' AND retry_at<=now() ORDER BY retry_at,thread_id LIMIT 1`,
        [a.connectionId],
      )
    ).rows[0];
    if (!job) return false;
    let complete = false;
    try {
      complete = await this.archive(
        {
          threadId: job.thread_id,
          profileId: job.profile_id,
          attempts: job.attempts,
        },
        a,
      );
    } catch {
      /* Preserve retryable job and original archive. */
    }
    await this.repo.db.transaction(async (tx) => {
      if (!(await this.repo.valid(tx, a))) return;
      await tx.query(
        `UPDATE google_sync_archive_jobs SET status=$4,attempts=attempts+1,retry_at=now()+interval '5 minutes',error_code=$5 WHERE connection_id=$1 AND thread_id=$2 AND fingerprint=$3`,
        [
          a.connectionId,
          job.thread_id,
          job.fingerprint,
          complete ? "complete" : "pending",
          complete ? null : "SYNC_ARCHIVE_RETRY",
        ],
      );
    });
    return true;
  }
}
