import type { SyncSql } from "./google-mailbox-sync-repository";
export class SyncReadModel {
  constructor(private db: SyncSql) {}
  async status(connectionId: string) {
    const row = (
      await this.db.query(
        `SELECT mode,cohort_limit AS "cohortLimit",checkpoint->>'phase' AS phase,last_success_at AS "lastSuccessAt",error_code AS "errorCode" FROM google_sync_accounts WHERE connection_id=$1`,
        [connectionId],
      )
    ).rows[0] ?? { mode: "off" };
    const counts = (
      await this.db.query(
        `SELECT count(*) FILTER(WHERE generation>processed_generation)::int AS pending,count(*) FILTER(WHERE generation>processed_generation AND error_code IS NOT NULL)::int AS blocked FROM google_sync_jobs WHERE connection_id=$1`,
        [connectionId],
      )
    ).rows[0];
    const review = (
      await this.db.query(
        `SELECT count(*)::int AS "linkReview" FROM google_sync_snapshots WHERE connection_id=$1 AND state='link_review'`,
        [connectionId],
      )
    ).rows[0];
    const archive = (
      await this.db.query(
        `SELECT count(*)::int AS "archivePending" FROM google_sync_archive_jobs WHERE connection_id=$1 AND status='pending'`,
        [connectionId],
      )
    ).rows[0];
    return { ...row, ...counts, ...review, ...archive };
  }
  async reviews(connectionId: string, cursor = "") {
    const rows = (
      await this.db.query(
        `SELECT s.thread_id AS "threadId",s.snapshot->>'subject' AS subject,s.snapshot->>'reason' AS reason,COALESCE(s.snapshot->'candidateProfileIds','[]'::jsonb) AS "candidateProfileIds",a.email FROM google_sync_snapshots s LEFT JOIN google_sync_accounts a ON a.connection_id=s.connection_id WHERE s.connection_id=$1 AND s.state='link_review' AND s.thread_id>$2 ORDER BY s.thread_id LIMIT 26`,
        [connectionId, cursor],
      )
    ).rows;
    return {
      items: rows
        .slice(0, 25)
        .map((r) => ({
          ...r,
          gmailUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(r.email ?? "")}#all/${encodeURIComponent(r.threadId)}`,
        })),
      nextCursor: rows.length > 25 ? rows[24].threadId : null,
    };
  }
  async list(input: {
    connectionId: string;
    profileId?: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(100, Math.max(1, input.limit ?? 25));
    const rows = (
      await this.db.query(
        `SELECT s.thread_id AS "threadId",s.profile_id AS "profileId",o.name AS "profileName",s.state,s.checked_at AS "checkedAt",s.availability,j.error_code AS "errorCode",jsonb_array_length(COALESCE(s.snapshot->'drafts','[]')) AS "draftCount" FROM google_sync_snapshots s LEFT JOIN organizations o ON o.id=s.profile_id LEFT JOIN google_sync_jobs j ON j.connection_id=s.connection_id AND j.thread_id=s.thread_id WHERE s.connection_id=$1 AND s.profile_id IS NOT NULL AND s.thread_id>$2 AND ($3::uuid IS NULL OR s.profile_id=$3) ORDER BY s.thread_id LIMIT $4`,
        [
          input.connectionId,
          input.cursor ?? "",
          input.profileId ?? null,
          limit + 1,
        ],
      )
    ).rows;
    return {
      items: rows.slice(0, limit),
      nextCursor:
        rows.length > limit ? (rows[limit - 1].threadId as string) : null,
    };
  }
  async detail(connectionId: string, threadId: string) {
    const row = (
      await this.db.query(
        `SELECT s.thread_id AS "threadId",s.profile_id AS "profileId",s.snapshot,s.state,s.checked_at AS "checkedAt",s.availability,j.error_code AS "errorCode",a.reason AS "ownerDecision" FROM google_sync_snapshots s LEFT JOIN google_sync_jobs j ON j.connection_id=s.connection_id AND j.thread_id=s.thread_id LEFT JOIN email_thread_attention a ON a.gmail_connection_id=s.connection_id AND a.thread_id=s.thread_id WHERE s.connection_id=$1 AND s.thread_id=$2`,
        [connectionId, threadId],
      )
    ).rows[0];
    if (!row) return null;
    const followups = row.profileId
      ? (
          await this.db.query(
            `SELECT id,kind,due_at AS "dueAt" FROM follow_ups WHERE organization_id=$1 AND completed_at IS NULL ORDER BY due_at NULLS LAST,id LIMIT 100`,
            [row.profileId],
          )
        ).rows
      : [];
    const { messages, ...snapshot } = row.snapshot ?? {};
    const latest = messages?.find(
      (m: { id: string }) => m.id === snapshot.latestMessageId,
    );
    return {
      ...row,
      snapshot: {
        ...snapshot,
        latestEmail: latest
          ? { ...latest, bodyText: latest.bodyText.slice(0, 1500) }
          : null,
      },
      followups,
    };
  }
}
