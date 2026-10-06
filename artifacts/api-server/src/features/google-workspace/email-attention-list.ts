import type { SqlQuery } from "../chatgpt-connection/contracts";
import type { AttentionActor } from "./email-thread-attention-types";
export type AttentionListInput = { gmailConnectionId: string; state: "needs_your_reply" | "waiting_for_their_reply"; cursor?: string; limit?: number };
export async function readAttentionList(db: SqlQuery, authorize: (actor: AttentionActor, write: boolean) => Promise<void>, actor: AttentionActor, input: AttentionListInput) {
  await authorize(actor, false);
  const limit = input.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !["needs_your_reply","waiting_for_their_reply"].includes(input.state)) throw new Error("EMAIL_ATTENTION_INPUT_INVALID");
  let before: { time: string; id: string } | null = null;
  if (input.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
      if (decoded.account !== input.gmailConnectionId || decoded.state !== input.state || !decoded.id || typeof decoded.id !== "string" || typeof decoded.time !== "string" || Number.isNaN(Date.parse(decoded.time))) throw new Error();
      before = decoded;
    } catch { throw new Error("EMAIL_ATTENTION_CURSOR_INVALID"); }
  }
  const current = (await db.query("SELECT id FROM google_workspace_connections WHERE (role='workspace' OR role IS NULL) AND status='connected' ORDER BY updated_at DESC,id DESC LIMIT 1")).rows[0];
  if (current?.id !== input.gmailConnectionId) throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
  const rows = (await db.query(
    "SELECT a.*,o.name AS profile_name FROM email_thread_attention a LEFT JOIN organizations o ON o.id=a.profile_id WHERE a.gmail_connection_id=$1 AND a.state=$2" +
    (before ? " AND (a.updated_at,a.id)<($3::timestamptz,$4::uuid)" : "") +
    " ORDER BY a.updated_at DESC,a.id DESC LIMIT $" + (before ? 5 : 3),
    before ? [input.gmailConnectionId,input.state,before.time,before.id,limit+1] : [input.gmailConnectionId,input.state,limit+1]
  )).rows;
  const items = rows.slice(0,limit).map(r => ({ id:r.id, gmailConnectionId:input.gmailConnectionId, threadId:r.thread_id, messageId:r.reviewed_message_id, profileId:r.profile_id, profileName:r.profile_name || "Linked profile", state:r.state, reason:r.reason, subject:r.subject, dueAt:r.due_at == null ? null : new Date(r.due_at).toISOString(), updatedAt:new Date(r.updated_at).toISOString() }));
  const last = items.at(-1);
  return {items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({account:input.gmailConnectionId,state:input.state,time:last.updatedAt,id:last.id})).toString("base64url") : null};
}
