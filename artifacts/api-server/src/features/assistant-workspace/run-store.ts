import type { Actor, Selection, Grant, Queryable } from "./contracts";
import type { TurnCheckpoint } from "./orchestrator";
export type RunInput = {
  actor: Actor;
  conversationId: string;
  sourceMessageId: string;
  requestKey: string;
  selection: Selection;
  grants: Grant[];
  model?: string;
};
export type SavedRun = {
  id: string;
  actorId: string;
  conversationId: string;
  requestKey: string;
  status: string;
  leaseToken: number;
  cancelRequested: boolean;
  input: RunInput;
  turn?: TurnCheckpoint;
};
function map(r: any): SavedRun {
  return {
    id: r.id,
    actorId: r.actor_id,
    conversationId: r.conversation_id,
    requestKey: r.request_key,
    status: r.status,
    leaseToken: r.lease_token,
    cancelRequested: !!r.cancel_requested_at,
    input: r.checkpoint.input,
    turn: r.checkpoint.turn,
  };
}
export class RunStore {
  constructor(private readonly db: Queryable) {}
  async submit(
    input: Omit<RunInput, "sourceMessageId">,
    text: string,
  ): Promise<SavedRun> {
    const r = await this.db.query(
      `WITH message AS (
      INSERT INTO assistant_workspace_messages(conversation_id,actor_id,request_key,role,body)
      SELECT id,actor_id,$3,'user',$4 FROM assistant_workspace_conversations WHERE id=$1 AND actor_id=$2
      ON CONFLICT(conversation_id,request_key,role) DO UPDATE SET body=excluded.body WHERE assistant_workspace_messages.body=excluded.body RETURNING id,conversation_id,actor_id
    ), run AS (
      INSERT INTO assistant_workspace_runs(conversation_id,actor_id,request_key,source_message_id,checkpoint)
      SELECT conversation_id,actor_id,$3,id,jsonb_build_object('input',$5::jsonb || jsonb_build_object('sourceMessageId',id)) FROM message
      ON CONFLICT(conversation_id,request_key) DO NOTHING RETURNING *
    ) SELECT * FROM run`,
      [
        input.conversationId,
        input.actor.id,
        input.requestKey,
        text,
        JSON.stringify(input),
      ],
    );
    if (r.rows[0]) return map(r.rows[0]);
    const existing = await this.db.query(
      `SELECT r.* FROM assistant_workspace_runs r JOIN assistant_workspace_messages m ON m.id=r.source_message_id WHERE r.conversation_id=$1 AND r.actor_id=$2 AND r.request_key=$3 AND m.body=$4`,
      [input.conversationId, input.actor.id, input.requestKey, text],
    );
    if (!existing.rows[0]) throw new Error("ASSISTANT_MESSAGE_CONFLICT");
    return map(existing.rows[0]);
  }
  async enqueue(input: RunInput): Promise<SavedRun> {
    const r = await this.db.query(
      `INSERT INTO assistant_workspace_runs(conversation_id,actor_id,request_key,source_message_id,checkpoint)
   SELECT c.id,c.actor_id,$3,m.id,$5::jsonb FROM assistant_workspace_conversations c JOIN assistant_workspace_messages m ON m.conversation_id=c.id AND m.actor_id=c.actor_id
   WHERE c.id=$1 AND c.actor_id=$2 AND m.id=$4 AND m.role='user'
   ON CONFLICT(conversation_id,request_key) DO NOTHING RETURNING *`,
      [
        input.conversationId,
        input.actor.id,
        input.requestKey,
        input.sourceMessageId,
        JSON.stringify({ input }),
      ],
    );
    if (r.rows[0]) return map(r.rows[0]);
    const prior = await this.db.query(
      `SELECT * FROM assistant_workspace_runs WHERE conversation_id=$1 AND actor_id=$2 AND request_key=$3`,
      [input.conversationId, input.actor.id, input.requestKey],
    );
    if (!prior.rows[0]) throw new Error("ASSISTANT_ACCESS_DENIED");
    return map(prior.rows[0]);
  }
  async get(actorId: string, id: string): Promise<SavedRun | null> {
    const r = await this.db.query(
      `SELECT * FROM assistant_workspace_runs WHERE id=$1 AND actor_id=$2`,
      [id, actorId],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async list(actorId: string, conversationId: string): Promise<SavedRun[]> {
    return (
      await this.db.query(
        `SELECT * FROM assistant_workspace_runs WHERE actor_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 30`,
        [actorId, conversationId],
      )
    ).rows.map(map);
  }
  async claim(workerId: string): Promise<SavedRun | null> {
    const r = await this.db.query(
      `WITH candidate AS (SELECT id FROM assistant_workspace_runs WHERE status='queued' OR (status='running' AND lease_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
   UPDATE assistant_workspace_runs SET status='running',worker_id=$1,lease_token=lease_token+1,lease_expires_at=now()+interval '180 seconds',updated_at=now() WHERE id IN (SELECT id FROM candidate) RETURNING *`,
      [workerId],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async save(actorId: string, id: string, token: number, turn: TurnCheckpoint) {
    const r = await this.db.query(
      `UPDATE assistant_workspace_runs SET checkpoint=jsonb_set(checkpoint,'{turn}',$4::jsonb),updated_at=now() WHERE id=$1 AND actor_id=$2 AND lease_token=$3 AND lease_expires_at>now() AND status='running' RETURNING id`,
      [id, actorId, token, JSON.stringify(turn)],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_LEASE_LOST");
  }
  async check(actorId: string, id: string, token: number) {
    const r = await this.db.query(
      `UPDATE assistant_workspace_runs SET lease_expires_at=now()+interval '180 seconds' WHERE id=$1 AND actor_id=$2 AND lease_token=$3 AND lease_expires_at>now() AND status='running' RETURNING cancel_requested_at`,
      [id, actorId, token],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_LEASE_LOST");
    if (r.rows[0].cancel_requested_at) throw new Error("ASSISTANT_CANCELLED");
  }
  async cancel(actorId: string, id: string) {
    await this.db.query(
      `UPDATE assistant_workspace_runs SET cancel_requested_at=now(),updated_at=now() WHERE id=$1 AND actor_id=$2 AND status IN ('queued','running')`,
      [id, actorId],
    );
  }
  async finish(actorId: string, id: string, token: number, status: string) {
    if (
      !["succeeded", "partial", "failed", "cancelled", "waiting"].includes(
        status,
      )
    )
      throw new Error("ASSISTANT_RUN_STATE_INVALID");
    const r = await this.db.query(
      `UPDATE assistant_workspace_runs SET status=$4,updated_at=now() WHERE id=$1 AND actor_id=$2 AND lease_token=$3 AND lease_expires_at>now() AND status='running' RETURNING id`,
      [id, actorId, token, status],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_LEASE_LOST");
  }
  async event(
    actorId: string,
    id: string,
    token: number,
    kind: string,
    payload: unknown,
  ) {
    await this.db.query(
      `INSERT INTO assistant_workspace_events(run_id,actor_id,kind,payload) SELECT id,actor_id,$4,$5::jsonb FROM assistant_workspace_runs WHERE id=$1 AND actor_id=$2 AND lease_token=$3 AND lease_expires_at>now()`,
      [id, actorId, token, kind, JSON.stringify(payload)],
    );
  }
  async events(actorId: string, id: string, after: number) {
    return (
      await this.db.query(
        `SELECT sequence,kind,payload,created_at FROM assistant_workspace_events WHERE actor_id=$1 AND run_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 100`,
        [actorId, id, after],
      )
    ).rows;
  }
}
