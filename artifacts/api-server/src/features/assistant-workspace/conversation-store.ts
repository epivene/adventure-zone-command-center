import {
  emptySelection,
  selectionSchema,
  type Queryable,
  type Selection,
  type Turn,
} from "./contracts";
import { z } from "zod";
import {
  buildConversationContext,
  type ConversationMemory,
  type HistoricalMessage,
} from "./conversation-context";
export type Message = Turn & {
  id: string;
  sequence: number;
  createdAt: string;
};
export type Conversation = {
  id: string;
  title: string;
  selection: Selection;
  summary: unknown;
  version: number;
  updatedAt: string;
  messages: Message[];
};
const message = (r: any): Message => ({
  id: r.id,
  role: r.role,
  text: r.body,
  ...(r.attachments?.length ? { attachments: r.attachments } : {}),
  sequence: Number(r.sequence),
  createdAt: new Date(r.created_at).toISOString(),
});
const historicalMessage = (r: any): HistoricalMessage => ({
  ...message(r),
  runId: r.run_id ?? null,
  requestedScope: selectionSchema.safeParse(r.requested_scope).data ?? null,
  resultScope: selectionSchema.safeParse(r.result_scope).data ?? null,
});
const historyOptions = z
  .object({
    beforeSequence: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
    query: z.string().max(200).nullable().optional(),
  })
  .strict();
const scopeJoin = `LEFT JOIN assistant_workspace_runs r ON r.conversation_id=m.conversation_id AND r.actor_id=m.actor_id AND r.request_key=m.request_key`;
const scopeColumns = `m.*, r.id AS run_id, r.checkpoint->'input'->'selection' AS requested_scope, r.checkpoint->'turn'->'selection' AS result_scope`;
const conversation = (r: any): Conversation => ({
  id: r.id,
  title: r.title,
  selection: selectionSchema.parse(r.selection),
  summary: r.summary,
  version: r.version,
  updatedAt: new Date(r.updated_at).toISOString(),
  messages: [],
});
export class ConversationStore {
  constructor(private readonly db: Queryable) {}
  private async cutoff(actorId: string, id: string, sourceMessageId: string) {
    const r = await this.db.query(
      `SELECT m.sequence FROM assistant_workspace_messages m
      JOIN assistant_workspace_conversations c ON c.id=m.conversation_id AND c.actor_id=m.actor_id
      WHERE m.id=$1 AND m.conversation_id=$2 AND m.actor_id=$3 AND m.role='user'`,
      [sourceMessageId, id, actorId],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_SOURCE_MESSAGE_MISSING");
    return Number(r.rows[0].sequence);
  }
  async context(actorId: string, id: string, sourceMessageId: string) {
    const cutoff = await this.cutoff(actorId, id, sourceMessageId);
    const rows = await this.db.query(
      `SELECT ${scopeColumns} FROM assistant_workspace_messages m ${scopeJoin}
      WHERE m.conversation_id=$1 AND m.actor_id=$2 AND m.sequence<=$3 ORDER BY m.sequence DESC LIMIT 30`,
      [id, actorId, cutoff],
    );
    const count = await this.db.query(
      `SELECT count(*) AS total FROM assistant_workspace_messages WHERE conversation_id=$1 AND actor_id=$2 AND sequence<=$3`,
      [id, actorId, cutoff],
    );
    return buildConversationContext(
      rows.rows.reverse().map(historicalMessage),
      Number(count.rows[0].total),
    );
  }
  async history(
    actorId: string,
    id: string,
    sourceMessageId: string,
    options: z.infer<typeof historyOptions>,
  ) {
    const args = historyOptions.parse(options);
    const cutoff = await this.cutoff(actorId, id, sourceMessageId);
    const rows = await this.db.query(
      `SELECT ${scopeColumns} FROM assistant_workspace_messages m ${scopeJoin}
      WHERE m.conversation_id=$1 AND m.actor_id=$2 AND m.sequence<=$3
      AND ($4::bigint IS NULL OR m.sequence<$4) AND ($5::text IS NULL OR position(lower($5) in lower(m.body))>0
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(m.attachments) attachment WHERE position(lower($5) in lower(attachment->>'filename'))>0))
      ORDER BY m.sequence DESC LIMIT 4`,
      [id, actorId, cutoff, args.beforeSequence ?? null, args.query || null],
    );
    const messages = rows.rows.slice(0, 3).map(historicalMessage);
    return {
      messages,
      sourceSequence: cutoff,
      nextBeforeSequence:
        rows.rows.length > 3 ? messages.at(-1)!.sequence : null,
      complete: rows.rows.length <= 3,
      query: args.query || null,
    };
  }
  async saveSummary(actorId: string, id: string, summary: ConversationMemory) {
    await this.db.query(
      `UPDATE assistant_workspace_conversations SET summary=$3::jsonb
      WHERE id=$1 AND actor_id=$2 AND
      CASE WHEN summary->>'throughSequence' ~ '^[0-9]+$' THEN (summary->>'throughSequence')::numeric ELSE 0 END <= $4`,
      [id, actorId, JSON.stringify(summary), summary.throughSequence],
    );
  }
  async create(actorId: string, title: string): Promise<Conversation> {
    const rows = await this.db.query(
      `insert into assistant_workspace_conversations(actor_id,title,selection) values($1,$2,$3::jsonb) returning *`,
      [
        actorId,
        title.trim().slice(0, 160) || "New conversation",
        JSON.stringify(emptySelection()),
      ],
    );
    return conversation(rows.rows[0]);
  }
  async list(actorId: string): Promise<Conversation[]> {
    const r = await this.db.query(
      `select * from assistant_workspace_conversations where actor_id=$1 order by updated_at desc,id desc limit 100`,
      [actorId],
    );
    return r.rows.map(conversation);
  }
  async get(actorId: string, id: string): Promise<Conversation | null> {
    const r = await this.db.query(
      `select * from assistant_workspace_conversations where id=$1 and actor_id=$2`,
      [id, actorId],
    );
    if (!r.rows[0]) return null;
    const messages = await this.db.query(
      `select * from assistant_workspace_messages where conversation_id=$1 and actor_id=$2 order by sequence`,
      [id, actorId],
    );
    return { ...conversation(r.rows[0]), messages: messages.rows.map(message) };
  }
  async append(
    actorId: string,
    id: string,
    requestKey: string,
    turn: Turn,
  ): Promise<Message> {
    if (
      !["user", "assistant"].includes(turn.role) ||
      !turn.text.trim() ||
      turn.text.length > 20000 ||
      !requestKey ||
      requestKey.length > 128
    )
      throw new Error("ASSISTANT_MESSAGE_INVALID");
    const r = await this.db.query(
      `with inserted as (
      insert into assistant_workspace_messages(conversation_id,actor_id,request_key,role,body)
      select id,actor_id,$3,$4,$5 from assistant_workspace_conversations where id=$1 and actor_id=$2
      on conflict(conversation_id,request_key,role) do nothing returning *
    ), touched as (
      update assistant_workspace_conversations set updated_at=now() where id=$1 and actor_id=$2 and exists(select 1 from inserted)
    ) select * from inserted`,
      [id, actorId, requestKey, turn.role, turn.text],
    );
    if (r.rows[0]) return message(r.rows[0]);
    const prior = await this.db.query(
      `select * from assistant_workspace_messages where conversation_id=$1 and actor_id=$2 and request_key=$3 and role=$4`,
      [id, actorId, requestKey, turn.role],
    );
    if (!prior.rows[0]) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");
    if (prior.rows[0].body !== turn.text)
      throw new Error("ASSISTANT_REQUEST_CONFLICT");
    return message(prior.rows[0]);
  }
  async setSelection(
    actorId: string,
    id: string,
    expectedVersion: number,
    selection: Selection,
  ): Promise<Conversation> {
    const parsed = selectionSchema.parse(selection);
    const r = await this.db.query(
      `update assistant_workspace_conversations set selection=$4::jsonb,version=version+1,updated_at=now() where id=$1 and actor_id=$2 and version=$3 returning *`,
      [id, actorId, expectedVersion, JSON.stringify(parsed)],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_VERSION_CONFLICT");
    return conversation(r.rows[0]);
  }
}
