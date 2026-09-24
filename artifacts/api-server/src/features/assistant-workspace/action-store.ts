import { createHash } from "node:crypto";
import type { ActionIntent, Queryable } from "./contracts";
export type ActionState =
  | "prepared"
  | "running"
  | "provider_started"
  | "uncertain"
  | "succeeded"
  | "failed"
  | "cancelled";
export type SavedAction = ActionIntent & {
  status: ActionState;
  result: unknown;
  leaseToken: number;
};
export function recoveryMode(status: string) {
  if (status === "succeeded") return "return_receipt";
  if (status === "provider_started" || status === "uncertain")
    return "reconcile";
  return "claim";
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const map = (r: any): SavedAction => ({
  id: r.id,
  conversationId: r.conversation_id,
  actorId: r.actor_id,
  kind: r.kind,
  targetId: r.target_id,
  expectedRevision: r.expected_revision,
  connectionId: r.connection_id,
  arguments: r.arguments,
  sourceMessageId: r.source_message_id,
  status: r.status,
  result: r.result,
  leaseToken: r.lease_token,
});
export class ActionStore {
  constructor(private readonly db: Queryable) {}
  async prepare(intent: ActionIntent): Promise<SavedAction> {
    const hash = fingerprint({
      arguments: intent.arguments,
      revision: intent.expectedRevision,
      connectionId: intent.connectionId,
    });
    const args = [
      intent.id,
      intent.conversationId,
      intent.actorId,
      intent.kind,
      intent.targetId,
      intent.expectedRevision,
      intent.connectionId,
      JSON.stringify(intent.arguments),
      hash,
      intent.sourceMessageId,
    ];
    const r = await this.db.query(
      `insert into assistant_workspace_actions(id,conversation_id,actor_id,kind,target_id,expected_revision,connection_id,arguments,argument_fingerprint,source_message_id)
   select $1,c.id,c.actor_id,$4,$5,$6,$7,$8::jsonb,$9,m.id from assistant_workspace_conversations c
   join assistant_workspace_messages m on m.conversation_id=c.id and m.actor_id=c.actor_id
   where c.id=$2 and c.actor_id=$3 and m.id=$10 and m.role='user'
   on conflict(actor_id,source_message_id,kind,target_id,argument_fingerprint) do nothing returning *`,
      args,
    );
    if (r.rows[0]) return map(r.rows[0]);
    const existing = await this.db.query(
      `select * from assistant_workspace_actions where actor_id=$1 and source_message_id=$2 and kind=$3 and target_id=$4 and argument_fingerprint=$5 and conversation_id=$6`,
      [
        intent.actorId,
        intent.sourceMessageId,
        intent.kind,
        intent.targetId,
        hash,
        intent.conversationId,
      ],
    );
    if (!existing.rows[0]) throw new Error("ASSISTANT_ACTION_NOT_AUTHORIZED");
    return map(existing.rows[0]);
  }
  async get(actorId: string, id: string): Promise<SavedAction | null> {
    const r = await this.db.query(
      `select * from assistant_workspace_actions where id=$1 and actor_id=$2`,
      [id, actorId],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async list(actorId: string, conversationId: string): Promise<SavedAction[]> {
    const r = await this.db.query(
      `select * from assistant_workspace_actions where actor_id=$1 and conversation_id=$2 order by created_at,id`,
      [actorId, conversationId],
    );
    return r.rows.map(map);
  }
  async claim(
    actorId: string,
    id: string,
    workerId: string,
  ): Promise<{ intent: SavedAction; leaseToken: number } | null> {
    const r = await this.db.query(
      `update assistant_workspace_actions set status='running',worker_id=$3,lease_token=lease_token+1,lease_expires_at=now()+interval '180 seconds',updated_at=now()
    where id=$1 and actor_id=$2 and (status='prepared' or (status='running' and lease_expires_at<now())) returning *`,
      [id, actorId, workerId],
    );
    return r.rows[0]
      ? { intent: map(r.rows[0]), leaseToken: r.rows[0].lease_token }
      : null;
  }
  async checkpoint(
    actorId: string,
    id: string,
    leaseToken: number,
    status: ActionState,
    result: unknown,
  ): Promise<SavedAction> {
    const allowed: Record<string, string[]> = {
      running: ["running"],
      provider_started: ["running"],
      uncertain: ["provider_started"],
      succeeded: ["running", "provider_started"],
      failed: ["running", "provider_started"],
      cancelled: ["running"],
    };
    if (!allowed[status])
      throw new Error("ASSISTANT_ACTION_TRANSITION_INVALID");
    const r = await this.db.query(
      `update assistant_workspace_actions set status=$4,result=$5::jsonb,lease_expires_at=now()+interval '180 seconds',updated_at=now()
    where id=$1 and actor_id=$2 and lease_token=$3 and lease_expires_at>now() and status=any($6::text[]) returning *`,
      [
        id,
        actorId,
        leaseToken,
        status,
        JSON.stringify(result),
        allowed[status],
      ],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_LEASE_LOST");
    return map(r.rows[0]);
  }
  async reconcile(
    actorId: string,
    id: string,
    result: unknown,
  ): Promise<SavedAction> {
    // Only a trusted provider-specific reconciler may call this after readback.
    const r = await this.db.query(
      `update assistant_workspace_actions set status='succeeded',result=$3::jsonb,updated_at=now() where id=$1 and actor_id=$2 and status in ('provider_started','uncertain') returning *`,
      [id, actorId, JSON.stringify(result)],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_ACTION_NOT_RECONCILABLE");
    return map(r.rows[0]);
  }
  async repairTracking(
    actorId: string,
    id: string,
    previous: unknown,
    result: unknown,
  ): Promise<void> {
    const r = await this.db.query(
      `UPDATE assistant_workspace_actions SET result=$4::jsonb,updated_at=now() WHERE id=$1 AND actor_id=$2 AND status='succeeded' AND kind='send_draft' AND result=$3::jsonb RETURNING id`,
      [id, actorId, JSON.stringify(previous), JSON.stringify(result)],
    );
    if (!r.rows.length) throw new Error("ASSISTANT_ACTION_CHANGED");
  }
  async requestCancel(actorId: string, runId: string): Promise<boolean> {
    const r = await this.db.query(
      `update assistant_workspace_runs set cancel_requested_at=now(),updated_at=now() where id=$1 and actor_id=$2 and status in ('queued','running') returning id`,
      [runId, actorId],
    );
    return r.rows.length === 1;
  }
}
