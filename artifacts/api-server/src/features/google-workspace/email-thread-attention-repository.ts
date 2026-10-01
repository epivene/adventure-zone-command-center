import { randomUUID } from "node:crypto";
import type { SqlQuery } from "../chatgpt-connection/contracts";
import type {
  AttentionPreview,
  AttentionRecord,
} from "./email-thread-attention-types";
const date = (v: any) => (v == null ? null : new Date(v).toISOString());
function record(r: any): AttentionRecord {
  return {
    id: r.id,
    gmailConnectionId: r.gmail_connection_id,
    threadId: r.thread_id,
    profileId: r.profile_id,
    eventYear: r.event_year,
    state: r.state,
    reason: r.reason,
    subject: r.subject,
    dueAt: date(r.due_at),
    followupId: r.followup_id,
    reviewedMessageId: r.reviewed_message_id,
    revision: r.revision,
    actorId: r.actor_id,
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
  };
}
export class EmailThreadAttentionRepository {
  constructor(private readonly db: SqlQuery) {}
  async read(account: string, thread: string): Promise<AttentionRecord | null> {
    const r = (
      await this.db.query(
        "SELECT * FROM email_thread_attention WHERE gmail_connection_id=$1 AND thread_id=$2",
        [account, thread],
      )
    ).rows[0];
    return r ? record(r) : null;
  }
  async commit(
    tx: SqlQuery,
    p: AttentionPreview,
    actorId: string,
  ): Promise<AttentionRecord> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
      p.gmailConnectionId,
      p.threadId,
    ]);
    const prev = (
      await tx.query(
        "SELECT * FROM email_thread_attention WHERE gmail_connection_id=$1 AND thread_id=$2 FOR UPDATE",
        [p.gmailConnectionId, p.threadId],
      )
    ).rows[0];
    if ((prev?.revision ?? null) !== p.expectedRevision)
      throw new Error("EMAIL_ATTENTION_STALE");
    const id = prev?.id ?? randomUUID(),
      revision = randomUUID();
    const row = (
      await tx.query(
        `INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,event_year,state,reason,subject,due_at,followup_id,reviewed_message_id,revision,actor_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
   ON CONFLICT(gmail_connection_id,thread_id) DO UPDATE SET profile_id=$4,event_year=$5,state=$6,reason=$7,subject=$8,due_at=$9,followup_id=$10,reviewed_message_id=$11,revision=$12,actor_id=$13,updated_at=now() RETURNING *`,
        [
          id,
          p.gmailConnectionId,
          p.threadId,
          p.profileId,
          p.eventYear,
          p.state,
          p.reason,
          p.subject,
          p.dueAt,
          p.followupId,
          p.latestMessageId,
          revision,
          actorId,
        ],
      )
    ).rows[0];
    const saved = record(row);
    await tx.query(
      "INSERT INTO email_thread_attention_audit(id,attention_id,actor_id,before_value,after_value) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        id,
        actorId,
        prev ? JSON.stringify(record(prev)) : null,
        JSON.stringify(saved),
      ],
    );
    return saved;
  }
}
